# Test Proof Audit

This note is narrower than the objective audit. It only answers what the current tests prove, what they do not prove, and why that is not enough for a production release claim.

## What The Suite Proves

| Test surface | Current proof | What it does not prove |
| --- | --- | --- |
| [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) | Planner directionality, live-remote preconditions, conflict detection, and refusal to apply stale or overlapping changes | It does not mutate the live source boundary, prove no data loss on production storage, or exercise a real remote/local topology |
| [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | File-backed journal sequencing, redaction, restart classification, and recovery state inspection | It does not prove durable production storage, crash survival on live state, or journal behavior across the real release boundary |
| [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) | Guardrail structure for benchmark modeling, refusal of unsupported throughput claims, and internal safety contracts | It does not measure live-path throughput or establish a release-grade speed claim |
| [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | Tamper detection and explicit refusal of unsupported benchmark claims | It does not prove that the live push path is fast, nor does it clear a release threshold |

## Why The Suite Is Not Release Proof

The tests are valuable because they catch local regressions and refuse unsafe claims. They are insufficient because they stop short of the live-source boundary that the objective requires. They prove guardrails, not no data loss, reliability, or speed on the production path. The practical implication is blunt: the suite can support a lab narrative, but it cannot by itself support a release narrative. Every passing test still needs to be read as fixture-, model-, or refusal-backed unless it mutates the live source in the same run, and a refusal-only green run still leaves `speed unclaimed` as a missing release verdict. A green `npm test` run therefore remains regression evidence only, not release evidence.

The missing proof is structural:

1. no test here proves the one-way pull base plus one-way push back to the live source on production storage
2. no test here proves crash, retry, replay, stale-lease, or duplicate-request safety on the live boundary
3. no test here composes auth/session, durable journal, leases/fencing, graph identity, and plugin-driver checks into one required release gate
4. no test here measures live-path throughput or converts the current `not-claimed` speed stance into an enforced release decision
5. no test here can be treated as release proof unless it runs through the same live-source boundary that the objective names, which means the current passing suite still leaves no-data-loss, reliability, and speed as unproven claims
6. no current test or smoke converts `productionThroughput: 'not-claimed'` into an enforced release verdict; that missing verdict is itself part of the blocker, not an incidental omission
7. the repo may now have helper coverage for production-shaped routes and authenticated flows, but helper coverage does not prove the production auth/session lifecycle, durable journal semantics, graph identity, plugin-driver behavior, or preserved-remote drift at apply time

## Practical Conclusion

A passing suite here supports a cautious lab narrative. It does not support a production release narrative, and it should not be read as proof that the live push path is lossless, durable, or fast enough.

If the repository wants to claim no data loss, reliability, or speed, those claims need a required live-source gate in addition to the current tests. Until then, the tests are evidence of guardrails, not release readiness. They can reject bad states in a lab, but they do not prove the live push path preserves data, survives failures, or meets a production speed threshold.

The actionable next step is therefore not to expand the current refusal checks in place. It is to add one mandatory command that reaches the live-source boundary and makes the release decision explicit. If throughput remains unmeasured, that command must still surface an enforced `speed unclaimed` verdict and fail closed; otherwise the suite is only refusing claims in a lab, not making a release decision. The missing command is the blocker, and the tests should be read as support evidence only until that command exists. Optional smokes and refusal-only benchmarks are still useful, but they remain non-gating evidence until the mandatory verdict exists.
