# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The repo still lacks one enforced command that proves the live-source boundary on the real storage and transport path. `npm test` passes, but the passing suite is still fixture- and model-backed. It does not prove no data loss, reliability, or speed on the live-source boundary, so the release claim is still false.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source.
2. Recheck the live source at apply time before mutating it.
3. Preserve every WordPress data shape the push can touch, including rows, files, plugin-owned data, serialized payloads, and graph identity.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary.
5. Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or any storage abstraction that can satisfy the tests without touching live source storage.
7. Either publish a measured speed claim from the live push path or explicitly refuse to make one. Refusal-only benchmarks are not a speed claim.
8. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
9. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix.
10. Keep optional smokes available for local evidence collection, but do not let them stand in for release proof.

## Proof Boundary

Current proof must be judged against the live-source release boundary, not against the existence of local helper paths. The following are useful inputs, but they are not release proof on their own:

- planner refusal tests that only compare fixtures
- journal tests that only read and write local files
- benchmark tests that only model a speed claim or refuse an unsupported one
- route smokes that still report `labBacked: true`
- any proof that does not exercise the one-way pull base to one-way push to live source loop

## Evidence Table

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `npm test` passes 89 Node subtests; the strongest assertions live in `test/push-planner.test.js`, `test/recovery-journal.test.js`, `test/performance-model.test.js`, and `test/guarded-executor-benchmark.test.js` | No executable test touches the live-source mutation boundary, exercises a real remote-to-local-to-remote release path, proves no data loss on production storage, or measures the live push path speed claim | Yes |
| Lab/fixture proof | Playground smokes cover route shape, auth flow, storage guards, stale-claim behavior, journal behavior, plugin packaging, and other local failure modes | These checks still run against local or fixture-backed storage, and the authenticated push path still reports `labBacked: true`, so they cannot prove the real remote/local topology or live-source release boundary | Yes |
| Docs-only proof | `docs/`, `progress.html`, and the audit notes describe the intended release flow and safety matrix | Prose does not enforce the matrix or prove the live path | Yes |
| Missing proof | No `verify`, `release`, or `verify:release` script in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json); no checked-in `.github/workflows/*`; no required command that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real topology, crash boundary, recovery, and a measured live-path speed check | The repo still lacks the single mandatory decision point that could make the live-source claim releasable; the current command set can still succeed without proving production release safety | Yes |
| Release blockers | `labBacked: true`, fixture-only scope, benchmark-only evidence, missing live-source proof, and missing enforced gate | None of these are acceptable as release proof | Yes |

## Test Audit

The current tests are useful, but they are not proof of no data loss, reliability, or speed at the production boundary.

| Test surface | What it proves | What it does not prove | Release value |
| --- | --- | --- | --- |
| `test/push-planner.test.js` and `npm test` | Planner refusal, remote-change protection, local deletion blocking, plugin-owned data blocking, and fixture-level conflict handling | No live-source mutation, no production storage boundary, no end-to-end no-loss proof, no real remote/local topology, no evidence that production writes survive retries or crashes | Blocker evidence only |
| `test/recovery-journal.test.js` | File-backed journal monotonicity, redaction, restart classification, and blocked recovery states | No durable production journal, no lease/fencing regime, no real crash recovery on the source boundary, no duplicate/write-loss proof on live storage, no evidence that a live apply is replay-safe | Blocker evidence only |
| `test/performance-model.test.js` | Benchmark shape, guardrails, refusal discipline, and safe-fast-path modeling | No measured throughput, no memory ceiling, no runtime threshold on a live push path, no production timing evidence, no proof that the speed story is anything more than a model | Blocker evidence only |
| `test/guarded-executor-benchmark.test.js` | Explicit refusal of unsupported throughput claims and tamper detection for benchmark evidence | No positive speed claim, no production-shaped timing result, no live-path benchmark threshold, no real live-source throughput measurement, no proof that a production release is fast enough | Blocker evidence only |
| `npm run test:playground:*` | Lab/fixture route shape, auth/session scaffolding, storage guard behavior, stale-claim classification, and journal smoke paths | No real remote/local topology, no production storage path, no enforced release gate | Lab evidence only |

## Release Blockers

The objective stays blocked for five concrete reasons:

1. There is no single required release command that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real remote/local topology, crash boundary, recovery, and a measured live-path speed check.
2. The strongest authenticated push route still self-identifies as `labBacked: true`, so the best visible push evidence is still lab-scoped.
3. The benchmark tests are refusal-only. They prove the suite can reject unsupported throughput claims, but they do not measure the live push path, publish a live-path threshold, or establish a production release speed claim.
4. The current recovery and journal tests are fixture-backed. They prove local model behavior, not durable production storage on the live source boundary, and they do not exercise a real remote-to-local-to-remote release path or no-loss behavior under the production storage semantics named by the objective.
5. There is no checked-in CI workflow in this checkout and no `verify`/`release`/`verify:release` script in `package.json`, so there is no visible enforced entrypoint that could make the release gate mandatory or close the loop from proof to deployable gate.
6. The tests that look strongest are still proving preconditions and refusal behavior, not end-to-end mutation safety under a crash boundary. That is useful, but it is not release evidence.

## Audit Rule

Treat fixture tests, refusal tests, route-shape smokes, benchmark models, and `labBacked: true` labels as useful but insufficient. They do not count as release proof unless they exercise the same live-source boundary named by the objective.
