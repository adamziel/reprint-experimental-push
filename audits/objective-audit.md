# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

## Derived Requirements

The objective implies the following minimum release requirements:

1. Pull the base one way, then push back to the live source one way, with the live source rechecked at apply time.
2. Preserve every WordPress data shape a push can affect, including related rows, files, plugin-owned data, serialized payloads, and graph identity.
3. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary, with the same behavior enforced on the real production storage and transport path.
4. Enforce auth, session, lease, fencing, durable journal, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes.
5. Prove the real remote/local topology, not just a local lab route shape, local Playground route, or fixture mount with the same hostname and different backing storage.
6. Either publish a measured speed claim from the live push path or explicitly refuse to make one.
7. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, missing live-source proof, or benchmark-only.
8. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix.
9. Keep the optional smokes available for local evidence collection, but do not let them stand in for release proof.
10. Fail the release gate on any claim that remains lab-backed, fixture-scoped, benchmark-only, or otherwise indirect.
11. Make the release gate print the last failing proof bucket so the missing release evidence is explicit.
12. Make the release gate the default enforced path in CI or equivalent automation so a green casual run cannot bypass it.

The key release point is not merely "tests pass." The project objective only becomes releasable when the same checked-in command proves the live-source release path, not just the fixture path or the refusal path.

Those requirements are the minimum release bar, not aspirational extras.

The current checkout does not yet satisfy those requirements at the release boundary. The closest evidence remains split across fixture tests, lab smokes, and refusal-oriented benchmark models. That means the audit must treat any positive claim as provisional unless it is backed by executable proof on the live-source release path, not by a green default test command or a production-shaped label alone.

Short version:

- `npm test` is still a safety harness, not a release harness.
- `npm run test:playground:*` commands are still evidence collectors, not release approvers.
- The missing release command is the strongest blocker because it is the only thing that can turn the existing proof fragments into a mandatory decision.

| Bucket | Current evidence | What it proves | Why it is not release proof |
| --- | --- | --- | --- |
| Executable proof | `npm test` runs 89 Node tests, including planner, recovery-journal, benchmark-model, and guarded-benchmark checks | Local invariants, refusal discipline, redaction, monotonic journal shape, and benchmark guardrails | It still does not reach the live-source mutation boundary the release claim names, so it can only block bad claims, not approve the good ones |
| Lab/fixture proof | `npm run test:playground`, `npm run test:playground:authenticated-http-push`, `npm run test:playground:authenticated-cli-push`, `npm run test:playground:production-shaped-push`, and the storage-guard, journal, process-kill, and stale-claim smokes | End-to-end route shape, journal flow, storage guard behavior, idempotency, and failure classification in Playground or fixture-backed routes | It still runs under lab-scoped or fixture-scoped route profiles and does not clear the live production boundary, even when the route looks production-shaped |
| Docs-only proof | `docs/supervised-lanes.md`, `progress.html`, [`audits/release-evidence-gap.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/release-evidence-gap.md), and the audit text naming the target protocol and safety matrix | The intended protocol, release flow, and safety gates are described clearly | Description does not enforce the gate, so it remains advisory only |
| Missing proof | No `verify`, `release`, or `verify:release` script in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json); no checked-in workflow tree because [`.github`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/.github) does not exist in this checkout; no measured live-path benchmark threshold; no enforced command that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, topology, crash-boundary, and speed proof | The repo still lacks a single required release decision point, and the default green path can still bypass the release bar by choosing an opt-in lab command | This is the gap that still blocks release and the reason the green default path is not release proof |
| Release blockers | `labBacked: true`, fixture-only scope, benchmark-only evidence, missing live-source proof, missing enforced gate, no checked-in CI gate | Any one of them keeps the release claim false; several are present at once | The objective cannot be released until these blockers are removed or replaced with live-source proof |

The weakest current requirement is the enforced release gate itself. The repo has many useful opt-in checks, but the objective is still blocked until one required command composes the safety matrix and fails closed when any claim is only lab-backed, fixture-scoped, benchmark-only, or otherwise indirect. Right now [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) only exposes `test`, `test:playground`, and separate opt-in smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:production-plugin-package`, `test:playground:db-journal-process-kill`, and `test:playground:storage-guarded-file-write`; there is still no `verify`, `release`, or `verify:release` script. A repo-wide scan also found no checked-in workflow files under `.github`, so there is no visible CI entrypoint to enforce a default release path. A green run can still stop short of the production bar, which means the strongest available evidence can still be bypassed by choosing the wrong command. That is not a documentation gap; it is a missing release control, and until it exists every other proof bucket remains bypassable. The actionable fix is a single required gate, such as `npm run verify:release`, wired into CI or the release pipeline, that refuses any lab-backed or fixture-only proof and is the only path that can support a release claim. The gate must be evaluated from the checked-in default automation path, not from operator memory or manual script composition. A production-shaped route is not enough on its own if the authenticated implementation still reports `labBacked: true`, and the absence of a checked-in workflow means the release control is not just unimplemented but unenforced. In practical terms, `npm test` and `npm run test:playground` are currently evidence collectors for local safety and refusal behavior, not release approvers.

The current highest-value follow-up is not another lab smoke; it is a checked-in release command that can be pointed at in review and CI. Until that exists, the audit should treat all passing tests as necessary but insufficient, because each one can still be bypassed by the choice of command rather than the state of the release evidence.

Gate shape still missing from this checkout:

1. One required `npm run verify:release` entrypoint in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) instead of separate opt-in scripts.
2. The command must print the last failing proof bucket before exiting non-zero.
3. The command must fail closed on any `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
4. The command must compose auth/session, durable journal, lease/fencing, graph identity, plugin-data-driver, topology, crash-boundary, and speed checks in one decision.
5. A checked-in workflow or equivalent default automation path must run the same command so a green casual run cannot bypass it.

## Test Verdict

The test suite is still an audit harness, not a release harness.

- It proves local invariants and refusal logic. `npm test` currently passes 89 tests, but that count is still just internal consistency evidence.
- It does not prove no data loss on the live source boundary.
- It does not prove real-world reliability against crash, retry, duplicate request, lease expiry, or mid-apply restart on production storage.
- It does not prove speed because the benchmark code refuses unsupported claims instead of timing the live push path.
- It does not prove a release-safe default because no checked-in command forces the whole proof matrix.
- It does not prove a default release path because all stronger checks remain opt-in scripts.
- It does not prove that any `npm run test:playground:*` command is release-safe; those scripts are still evidence collectors, not release approvers.
- It does not yet prove the production graph identity, plugin-data-driver, or topology claims that the objective requires at release time.

Current test audit, stripped down:

- `test/push-planner.test.js` and `test/recovery-journal.test.js` prove model and file-backed behavior, not live-source durability.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove refusal discipline, not measured throughput.
- The optional playground smokes prove route shape and failure classification, but they still run behind lab profiles or fixture-backed storage.
- None of the tests are wired into a single required release decision, so green local output can still leave the production claim false.

Minimal gate contract:

1. One checked-in command, preferably `npm run verify:release`.
2. A non-zero exit when any required check is still lab-backed, fixture-only, benchmark-only, or missing live-source proof.
3. An explicit final failing bucket in the output so the operator knows what remains unproven.
4. A checked-in workflow or equivalent default entrypoint that runs the same command, not a weaker substitute.
5. No release claim unless the same command also covers auth/session, durable journal, lease/fencing, graph identity, plugin-data-driver, topology, crash-boundary, and speed proof.

## Release Gate Gap

The release gate is the highest-value missing proof because it is the only thing that would turn the current evidence buckets into a mandatory release matrix.

Required properties for the gate:

1. Run from one checked-in command.
2. Fail closed on any `labBacked: true`, fixture-only, benchmark-only, or missing-live-source claim.
3. Include the auth/session, durable journal, lease/fencing, graph identity, plugin-data-driver, topology, crash-boundary, and speed checks in the same decision.
4. Report the final failing proof bucket while still failing closed on the first unmet gate.
5. Be wired into CI or another default entrypoint so a green default run cannot bypass it.

Current state:

- No checked-in `verify`, `release`, or `verify:release` script exists.
- No checked-in workflow file exists in this checkout.
- The strongest push smoke still labels its route `labBacked: true`.
- The suite can therefore prove local invariants and lab refusal, but it cannot yet force a release-safe decision.
- A green default run can still stop at `npm test` or a standalone smoke and never exercise the full release matrix.
- The only top-level automation surface in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) is still opt-in test and smoke commands, so release approval remains a manual command-choice problem rather than an enforced gate.

The exact missing proof bucket is now clear enough to act on:

- [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) does not contain a release entrypoint, so the strongest evidence is still opt-in by command choice.
- There is no checked-in `.github/workflows/*` file, so the repository has no visible default CI path that can enforce the release matrix.
- The remaining live-source, durable-journal, lease/fencing, graph-identity, plugin-driver, and benchmark claims are therefore still selectable rather than mandatory.

Concrete release-gate evidence today:

- `npm test` is only `node --test`; it does not compose the release matrix.
- `npm run test:playground` only chains `plan`, `apply`, and `push-protocol`; it does not require auth/session, journal durability, leases/fencing, graph identity, plugin-driver, real topology, crash-boundary, or benchmark proof.
- The stronger checks are individually callable, but nothing forces them to run together before a release claim. That includes the optional auth and route smokes, the database and file journal smokes, the process-kill and stale-claim recovery smokes, the plugin-atomic-install smoke, and the storage-guard smokes.
- No checked-in workflow file exists in this checkout, so there is no default CI path to enforce the missing gate.
- The strongest authenticated route still self-identifies as `labBacked: true`, so even a successful smoke is labeled as lab evidence rather than release evidence.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` are refusal proofs only; they prove unsupported throughput claims stay blocked, but they do not time the live push path or establish a release threshold.

The current lab/prod boundary is also explicit in code. [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js#L60-L74) still marks the authenticated route profile as `labBacked: true`, and that flag feeds the strongest authenticated push smoke. So even the best-looking push path is still self-described as lab evidence, not release evidence. That is useful for honest labeling, but it is also the clearest sign that the release claim cannot yet rest on that flow. Until a non-lab-backed path exists and is required by policy, the objective remains blocked.

Next required release step:

1. Add one checked-in `npm run verify:release` entrypoint.
2. Make it fail closed on any `labBacked: true`, fixture-only, benchmark-only, or missing-live-source proof.
3. Make it print the final failing proof bucket before it exits.
4. Wire that same command into the default automation path so a green casual run cannot bypass the release matrix.

## Evidence Standard

Only executable evidence at the boundary being claimed counts as proof. Fixture passes, lab backends, refusal-only tests, and `labBacked: true` route labels are useful for honest scoping, but they do not clear a production release claim unless they exercise the same boundary that the claim names.

Design docs, model tests, and fixture smokes are useful, but they are indirect for production claims unless they exercise the same authentication, storage, journal, crash, concurrency, and WordPress data semantics that production will depend on.

A test that only proves refusal, redaction, or route shape is still indirect for affirmative claims about no data loss, reliability, or speed.

For this audit, the proof buckets are strict:

- `Executable proof` exercises the claimed production boundary directly and is the only bucket that can satisfy a release claim.
- `Lab/fixture proof` is real code but still scoped to local Playground, a fixture mount, or another non-production backend.
- `Docs-only proof` is prose or script naming without an enforced executable gate.
- `Missing proof` is the specific production evidence still absent.
- `Release blocker` is the reason the objective remains unreleasable.

When reading the table, treat any non-executable bucket as insufficient for a release claim. A row only becomes release-acceptable when the `Executable proof` column covers the same boundary named in the requirement and the `Missing proof` and `Release blocker` columns are both empty.

For this checkout, "current proof" is intentionally split into:

- `Executable proof`: a test or command that runs the claimed behavior directly.
- `Lab/fixture proof`: a real execution, but still against local Playground, fixtures, or other non-production storage.
- `Docs-only proof`: a description of the intended release behavior without a required executable gate.
- `Missing proof`: the exact production evidence still absent.
- `Release blocker`: the reason the release claim still fails closed.

The current checkout still has no executable proof at the live-source release boundary. Everything strongest today is either model-level, fixture-scoped, or explicit refusal evidence, so the audit remains in the "blocked" state until that changes.

For this audit:

- `Executable proof` means the test or command exercises the claimed behavior directly at the claimed boundary.
- `Lab/fixture proof` means the check is useful but still scoped to fixtures, local Playground, or a temporary package route.
- `Docs-only proof` means the claim appears in prose, script names, or diagrams, but not in a required executable gate.
- `Release blocker` means the objective still fails closed until stronger proof exists.
- `No release workflow` means there is no checked-in CI path to force the release matrix, so a green casual run can still bypass the missing proof.

## Evidence Table

The table below is strict by design:

- `Current proof` may be executable, lab/fixture, or docs-only, but only executable proof can satisfy a release claim.
- `Missing proof` names the concrete production evidence still absent.
- `Release blocker` states why the objective is still unreleasable.

| Requirement | Executable proof | Lab/fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, one-way push to live source | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) models remote-only protection and conflict refusal. It does not exercise the actual live source boundary. | [`npm run test:playground`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) fans out through local Playground plan/apply/push protocol checks. | [`README.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/README.md), [`docs/protocol.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/protocol.md), and [`docs/playground-topology.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/playground-topology.md) describe the intended flow. | Live-source push evidence that rechecks the current source immediately before mutation and preserves the pull base as a one-way snapshot. | Yes: the current success paths are still local or modeled, so the live source boundary is unproven. |
| Preserve all affected WordPress data shapes | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) cover selected rows, hashes, redaction, and restart classifications. | File-backed journal and fixture smokes exercise some data shapes, but only in controlled lab state. | [`docs/recovery/acceptable-states.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/recovery/acceptable-states.md) and [`docs/invariants/no-overwrite.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/invariants/no-overwrite.md) describe the desired shapes. | Exhaustive live-source coverage for arbitrary DB rows, files, plugin-owned data, serialized payloads, graph identity, and same-plan rewrites. | Yes: indirect coverage cannot prove no-loss behavior. |
| Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart | [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves journal restart classification and integrity handling on temporary files. | Process-kill, stale-claim, idempotency, and replay smokes exist in Playground scope. | [`docs/recovery/apply-journal.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/recovery/apply-journal.md) describes the intended contract. | Production-backed journal durability, lease/fencing behavior, and crash recovery on the real storage and transport path. | Yes: the crash matrix is still fixture-scoped. |
| Enforce auth, session, lease, fencing, durable journal, storage, graph identity, and plugin-data-driver checks at the release boundary | [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js) and the benchmark tests show some guard logic exists, but not as one release decision. | Optional smokes prove some guards fail closed, but only inside opt-in commands and lab backends. | [`docs/executor.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/executor.md), [`docs/protocol.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/protocol.md), and `fixtures/protocol/*` describe the checks. | A required production release gate that enforces all of them together on the live boundary and rejects any `labBacked: true` proof. | Yes: the checks are split across optional commands only, so the gate is still missing. |
| Prove real remote/local topology | Local ingress on port `8080`, Playground blueprints, and authenticated lab routes approximate the topology. | Local route and fixture smokes exercise the lab server topology. | [`docs/playground-topology.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/playground-topology.md) documents the intended topology. | Evidence from the actual remote/local production topology with a live source and live push target. | Yes: topology proof remains lab-only. |
| Either publish a measured speed claim from the live push path or explicitly refuse to make one | [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) refuse unsupported throughput claims. | The benchmark model encodes gating, backpressure, and refusal states, but it does not time the live push path. | [`docs/fast-paths.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/fast-paths.md) and [`docs/approach-scorecard.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/docs/approach-scorecard.md) discuss intended speedups. | A measured runtime or memory result from the production-shaped push path, with stated thresholds, a repeatable measurement contract, and an enforced release threshold. | Yes: speed is still refusal-only, not measured production proof. |
| Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, missing live-source proof, or benchmark-only | [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) exposes only `test` and opt-in playground/recovery scripts; `npm test` is just `node --test`. | The strongest auth and push smokes still advertise `labBacked: true`, so even the best current path self-identifies as lab evidence rather than release evidence. | Script names and comments imply a desired release sequence. | A mandatory `verify:release`-style entrypoint that fails closed instead of letting operators assemble only the easy checks or trust a green lab-only default; it must enumerate the failing bucket so the release blocker is obvious. | Yes: there is still no required gate, and `package.json` has no `verify`, `release`, or `verify:release` script to enforce one. |
| Wire the release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix | `npm test` and `npm run test:playground` prove local invariants and lab flows, but only within opt-in commands. That is not release-enforced execution. | No checked-in workflow file or equivalent default release target is present in this checkout; the repo has no `.github/workflows/*` file to inspect or enforce. | `package.json` and the absence of `.github` are the only visible automation clues. | A single checked-in release path that includes auth/session, durable journal, lease/fencing, graph identity, plugin-driver, real topology, crash-boundary, recovery, and benchmark checks. | Yes: the strongest checks are still opt-in and there is no workflow file or other checked-in automation to enforce a default run. |

## Evidence Notes

- The strongest executable evidence in this checkout is still refusal-oriented or fixture-scoped. It shows that unsafe shortcuts are blocked, but it does not show that the live source boundary is safe.
- A passing `npm test` run, even at 89 tests, is still blocker evidence only. It confirms the current model and fixture suite are internally consistent, but it does not prove no data loss, reliability, or speed on the live source boundary.
- `test/recovery-journal.test.js` proves journaling and restart classification on temporary JSONL files and local site objects, which is useful proof of invariants but not proof of production durability.
- `test/performance-model.test.js` proves the benchmark model refuses unsupported speed claims and keeps gate obligations intact. It does not measure a live push path, define a threshold, or establish a release-speed claim.
- `package.json` shows the release gap plainly: many opt-in smokes exist, but no required release command exists to combine auth, journal, lease/fencing, graph identity, plugin-driver, topology, crash, and speed proof into one failing-closed gate.

## Test Audit

The current tests are strongest where they reject unsafe claims, and weakest where they are asked to prove production release safety on the live push path. Their strongest value today is refusal evidence, not approval evidence.

That distinction matters for the objective itself:

- No data loss is still unproven because the suite never exercises a real live-source mutation boundary and then verifies every affected WordPress shape after an apply-time recheck.
- Reliability is still unproven because the crash, retry, replay, duplicate-request, stale-claim, lease-expiry, and restart scenarios are only shown in fixtures or lab routes, not on the production storage and transport path.
- Speed is still unproven because the benchmark surface refuses unsupported throughput claims instead of timing the live push path against a release threshold.

For the objective's headline claims, the evidence is still negative proof only:

- No data loss is not proven by planner, replay, or journal-model tests unless they reach the live source boundary and verify every affected WordPress shape survives apply-time rechecks.
- Reliability is not proven by crash, replay, stale-claim, or process-kill fixtures unless they run against the real storage and transport path with durable fencing.
- Speed is not proven by benchmark-model or guarded-executor tests unless they time the live push path against a stated runtime and memory threshold.

That is not a wording issue. The suite can falsify bad claims, but it still cannot certify the good claims the objective needs because the strongest push path remains labeled `labBacked: true`, the recovery tests stay fixture-scoped, and the benchmark checks stop at refusal rather than timing a real live-source push. The green `npm test` result only proves the current model and fixture suite are internally consistent; it does not prove release readiness, no data loss, reliability, or live-path speed.

The specific claims the tests do not yet prove are the ones the objective cares about most:

- No data loss on a live WordPress source after pull-base reuse, retry, replay, or mid-apply restart.
- Reliability across crash, duplicate request, stale claim, lease expiry, and fencing on the real storage and transport path.
- Speed on the production-shaped push path with a measured runtime and memory threshold, not just a refusal-only benchmark model.
- One enforced release approval command that fails closed when any proof bucket is still lab-backed, fixture-only, benchmark-only, or missing.

What the suite does prove is narrower:

- `npm test` validates planner and journal invariants in isolated Node tests.
- `npm run test:playground` chains a few lab route checks.
- `test/recovery-journal.test.js` proves file-backed restart classification and redaction.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` refuse unsupported speed claims and preserve benchmark guardrails. They do not measure a live push path, so they are proof that speed is not yet established, not proof that the path is fast enough to ship.

Those are useful proofs, but none of them reaches the release boundary. They do not prove that the live source keeps every affected WordPress shape intact, that storage writes are durable on the real transport path, or that a default green command is the same command a release would trust.

That distinction matters for the objective claims:

- No-data-loss is not proven unless the test reaches the live source boundary and verifies that every affected WordPress shape survives a failed or retried push.
- Reliability is not proven unless the suite exercises real crash, retry, stale-claim, and lease/fencing behavior on the real storage and transport path.
- Speed is not proven unless the suite measures the production-shaped push path against a stated threshold and memory ceiling. Refusal-only benchmark tests do not count as performance proof.

- `npm test` proves the model and selected fixture logic are internally consistent. It does not prove live source mutation, production storage, or a live WordPress graph, so it cannot support the no-data-loss claim by itself.
- `npm run test:playground` proves a bundled lab path through plan/apply/push protocol. It does not invoke the stronger auth, journal, storage, recovery, plugin, graph, or benchmark gates, so it cannot support the reliability claim by itself.
- `npm run test:playground` also proves only the default chained lab path. It is not a release command, and it does not fail closed on `labBacked: true`, fixture-only, or benchmark-only claims.
- `test/recovery-journal.test.js` proves restart classification, monotonic sequencing, and raw-value redaction in a file-backed journal model. It does not prove durable production storage, lease/fencing behavior, or crash recovery on the live source boundary.
- `npm run test:playground:authenticated-http-push`, `npm run test:playground:authenticated-cli-push`, `npm run test:playground:production-shaped-push`, and `npm run test:playground:production-plugin-package` are the closest release-shaped smokes, but they are still route-shape and packaging evidence. The code still marks the authenticated route profile as `labBacked: true`, so these checks remain explicit lab proof rather than live production proof.
- The stronger scripts in `package.json` are all opt-in and still separate: auth, production-shaped route/package, db journal, storage guards, process-kill, missing-finalization, stale-claim, recovery, forms table, and file-journal checks can each pass independently while the release bar remains unmet.
- The suite has no single must-pass command that composes the whole safety matrix. That means no test currently proves that a default green path is the same path a release would use.
- The repository also has no checked-in workflow file to force that matrix in default automation, so even a fully green local run would still be bypassable by command choice.
- The benchmark tests are especially important to read correctly: `test/performance-model.test.js` proves the model refuses unsupported speed claims, and `test/guarded-executor-benchmark.test.js` proves tampered benchmark evidence and claimed throughput stay blocked. Neither test times the live push path, so neither one can satisfy the speed requirement for release.
- `test/push-planner.test.js` and `test/recovery-journal.test.js` prove planner invariants, redaction, sequence monotonicity, and restart classifications in fixtures. They do not prove a live WordPress source site survives a failed push, a restart, or a duplicated request without data loss.
- `test/playground-snapshot-lib.test.js` proves the PHP helper rejects unsupported fixture resources and table names. That is useful input validation, not release evidence for production plugin data drivers or live graph identity.
- `test/performance-model.test.js` proves the benchmark model keeps proof obligations attached to the proposed fast paths, large-upload and plugin-install shapes, atomic-group staging, and guardrails. `test/guarded-executor-benchmark.test.js` proves the refusal path on tampered evidence and blocked production throughput claims. Together they prove refusal discipline and model shape, not speed. They do not measure a production push path, set an actual runtime or memory threshold, or prove that the live source topology is fast.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` are therefore blocker tests, not release-speed evidence. They can tell you when a throughput claim is unsupported, but they cannot tell you that the live push path is actually fast enough to ship.
- The authenticated push smokes are still labeled `labBacked: true`, so even a green run there is a lab pass, not release proof.
- All of the optional smokes can pass at once and still leave the objective blocked, because none of them is mandatory, none of them is the single enforced decision point the release bar needs, and there is no checked-in CI workflow to force a default release path.
- The tests are honest about their limits, but honesty is not sufficiency. They are currently proving "safe to explore" rather than "safe to release," and the absence of a required `verify:release`-style script means even a green run is still the wrong kind of success.
- The missing release gate is the real test gap: until one command composes auth/session, durable journal, lease/fencing, graph identity, plugin-driver, topology, crash-boundary, and speed checks, no individual passing test can be treated as approval evidence.

## Actionable Gap

The weakest current claim is still the release gate itself. The repo needs one required executable entrypoint that:

1. Runs the release-relevant auth/session, durable journal, lease/fencing, graph identity, plugin-data-driver, topology, crash-boundary, and benchmark checks together.
2. Fails closed when any proof bucket is only `labBacked: true`, fixture-only, benchmark-only, or missing live-source evidence.
3. Prints the last failing proof bucket so the operator can see which claim is still unproven.
4. Is wired into CI or another default enforced path so a green casual run cannot bypass it.
5. Treats live-source proof as mandatory, not optional, so a successful lab smoke cannot satisfy the release bar by itself.

Without that single unskippable gate, the current proof remains split across optional lab commands and model checks, which is exactly the bypass the objective must eliminate. Until the gate exists, every positive claim remains conditional on operator command choice instead of enforced release policy.

Until that exists, the strongest tests in this checkout remain useful audits of behavior, but they do not establish release readiness.
- The current test surface is therefore honest about risk, but honesty is not enough: it proves that the suite can refuse unsafe claims, not that the live release path is safe. The separate [`audits/release-evidence-gap.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/release-evidence-gap.md) note captures the same split in a shorter form. Until one checked-in command composes the full safety matrix and fails closed on the first missing bucket, every passing test remains audit evidence rather than release approval.
- The concrete next proof gap is a mandatory release command that fails closed on the first unproven bucket and surfaces the bucket name in its output, so operators cannot miss whether the blocker is live-source proof, durability, topology, graph identity, or speed.
- In practical terms, the suite currently proves "we refuse to overclaim" much better than it proves "we can safely release."
- Green output from the current suite can still coexist with an unproven live push path, so a passing test run is not evidence that the objective has been met.

The uncomfortable conclusion is that the suite proves guardrails, not release safety. If the release claim depends on no data loss, reliability, or speed, the current tests are still missing the only evidence that would make those claims credible:

- a live-source push that mutates the real target after a pull-base snapshot;
- a durable production journal on the real storage path;
- a real lease/fencing boundary that prevents concurrent or stale writers;
- a measured end-to-end benchmark on the production-shaped push path with a stated threshold;
- one enforced gate that fails closed when any of the above is still fixture-only or refusal-only.

Put differently: the suite can demonstrate that the project knows what it cannot yet prove, but it cannot yet prove the objective itself.

## Test Claim Audit

What the current tests actually prove:

- `test/push-planner.test.js` proves the planner and executor model reject stale identities, preserve fixture invariants, and attach recovery evidence when a failure is injected.
- `test/recovery-journal.test.js` proves the file-backed journal keeps monotonic records, redacts raw values, and classifies restart-inspectable failure states in the journal model.
- `test/performance-model.test.js` proves the benchmark model encodes the intended gates, refusal states, and safe-speedup guardrails.
- `test/guarded-executor-benchmark.test.js` proves unsupported throughput claims are refused when the model reports missing durable evidence.
- None of those benchmark tests time the live push path, so they are refusal proof, not speed proof.
- The `npm run test:playground:*` scripts prove several lab-shaped route and storage slices, but they remain optional and do not collapse into one enforced release decision.
- `npm test` is therefore a blocker check, not a release approver: it proves local invariants and refusal discipline, but it does not touch the live-source mutation boundary named by the objective.
- The benchmark suite is likewise a blocker check, not a speed approver: it protects against unsupported throughput claims, but it does not time the live push path or establish an acceptance threshold on production storage and transport. There is still no measured production threshold in the repo, only refusal of unsupported claims.

What they do not prove:

- They do not prove a production WordPress source site keeps rows, uploads, and plugin-owned data intact through a live push.
- They do not prove production auth/session, lease/fencing, or durable journal storage on the real transport path.
- They do not prove recovery after a real process death or duplicated request against a live source site.
- They do not prove speed for the live boundary because no required benchmark runs there, and no enforced gate requires that proof.
- They do not prove that any single green command is sufficient for release, because the evidence is still split across optional commands.
- They do not prove a production speed claim because the benchmark checks are model-level or refusal-only; no live push path benchmark is enforced here.
- They do not prove a release-safe no-loss or reliability claim either, because the strongest recovery artifacts still come from fixtures and lab-backed routes, not from a required live-source gate.

Direct claim verdict:

- No data loss: unproven. The suite checks planner and journal invariants, but it never proves live-source mutation plus end-to-end preservation of every affected WordPress shape.
- Reliability: unproven. The suite simulates crash and replay cases in fixtures or lab routes, but it does not prove the real storage and transport path survives them without loss or reorder.
- Speed: unproven. The benchmark code refuses unsupported throughput claims, but it does not measure the live push path or enforce a runtime or memory threshold.

Claim-by-claim test verdict:

- No data loss: not proven. The tests cover planner and journal invariants, but they do not execute a live-source mutation boundary that rechecks the current remote immediately before apply and then verifies all affected WordPress shapes survive.
- Reliability: not proven. The tests simulate recovery conditions and stale-claim handling in fixtures or lab routes, but they do not prove crash, retry, duplicate request, lease expiry, or mid-apply restart behavior on the real storage and transport path.
- Speed: not proven. The benchmark tests only refuse unsupported throughput claims and describe safe fast-path structure. They do not time the live push path, establish a threshold, or prove memory/runtime ceilings on the release boundary.

That is why the suite remains a proof of refusal and local safety modeling, not a proof of release readiness.
The uncomfortable but useful reading is that the suite is more trustworthy as a blocker than as an approver.

## Evidence Ledger

| Bucket | Current evidence | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Executable proof | `npm test`, `test/push-planner.test.js`, `test/recovery-journal.test.js`, `test/performance-model.test.js`, `test/guarded-executor-benchmark.test.js` | Planner invariants, recovery classifications, redaction rules, refusal logic, model-level safety constraints, and benchmark proof obligations | Live source mutation, production topology, durable production storage, or measured speed on the release path. `npm test` is still only blocker evidence because it does not reach the live source boundary or the real release gate. |
| Lab/fixture proof | `npm run test:playground`, `npm run test:playground:authenticated-http-push`, `npm run test:playground:authenticated-cli-push`, `npm run test:playground:db-journal-idempotency`, `npm run test:playground:storage-guarded-db-write`, `npm run test:playground:storage-guarded-file-write`, `npm run test:playground:mid-apply-drift`, `npm run test:playground:db-journal-process-kill`, `npm run test:playground:db-journal-missing-commit-finalization`, `npm run test:playground:db-journal-stale-claim-all-old`, `npm run test:playground:recovery`, `npm run test:playground:production-shaped-push`, `npm run test:playground:production-plugin-package`, `npm run test:playground:plugin-atomic-install`, `npm run test:playground:http-push`, `npm run test:playground:forms-lab-table` | Useful end-to-end slices through local Playground, route shape, journal behavior, drift handling, and fixture storage guards | Production WordPress semantics, durable production storage, live-source auth/session, lease/fencing enforcement, or a live remote/local topology |
| Docs-only proof | `README.md`, `docs/*`, script names, and comments | The intended release bar, data-loss concerns, and desired check ordering are described | No executable proof that the described release bar is actually enforced |
| Missing proof | [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) has no required `verify:release`-style command; this checkout has no `.github` directory, so there is no visible CI entrypoint that composes auth/session, journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and benchmark checks. | Nothing by itself; this bucket marks the gap. | The objective still lacks a single required release gate that fails closed when any safety proof remains optional, and there is no checked-in automation to prevent a green default run from bypassing the hardest checks. `npm test` and `npm run test:playground` therefore remain insufficient by design. |
| Release blocker | The best evidence still says `labBacked: true` for the production-shaped route/package smokes, the benchmark path remains refusal-only, and the strongest checks are still opt-in scripts rather than one enforced release path. `package.json` still exposes only `test`, `test:playground`, and standalone smoke commands, and there is still no checked-in workflow file under `.github/workflows`. | Honest refusal to overclaim release readiness | Production no-data-loss, reliability, and speed remain unproven until a required release gate exists and live-source evidence exists, so the release claim still fails closed. |
| Release blocker | [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js#L60-L74) still self-identifies the authenticated push profile as `labBacked: true`, and this checkout still has no `.github` workflow file or equivalent checked-in CI entrypoint. | Honest refusal to overclaim release readiness | The release claim still fails closed because the strongest visible authenticated flow remains lab-labeled and there is still no enforced release gate to stop a green default run from bypassing the missing proof. |

## Command Verdict

| Command | Status | Release reading |
| --- | --- | --- |
| `npm test` | Executable proof | Useful as a blocker check, but it does not prove the live-source boundary, so it cannot approve release. |
| `npm run test:playground` | Lab/fixture proof | Useful for local route and storage evidence, but it still leaves the strongest authenticated path labeled `labBacked: true`. |
| `npm run test:playground:authenticated-http-push` | Lab/fixture proof | Auth and session evidence only; the route profile is still explicitly lab-backed. |
| `npm run test:playground:db-journal-process-kill` | Lab/fixture proof | Crash/restart evidence only; it still runs in Playground scope rather than production storage. |
| `npm run test:playground:storage-guarded-file-write` | Lab/fixture proof | Storage guard evidence only; it still uses fixture-backed file drivers rather than a live source boundary. |
| `npm run test:playground:production-shaped-push` | Lab/fixture proof | Production-shaped is not production-proven when the release gate itself is missing. |
| `npm run test:playground:production-plugin-package` | Lab/fixture proof | Packaging and route-shape evidence only; not a release decision. |
| `npm run verify:release` | Missing proof | This is the required shape of the missing gate, but it does not exist in this checkout and there is no CI workflow tree to enforce it. |

## Release Verdict

The release verdict remains **blocked**.

The reason is not that the repo lacks useful tests. It has them. The reason is that the tests stop at indirect proof, refusal proof, and lab proof. None of those buckets clears the live-source boundary that the objective names, and none of them is enforced by a required release command or checked-in CI workflow.

Until one checked-in gate fails closed on `labBacked: true`, fixture-only, benchmark-only, or missing live-source evidence, the project can still produce green runs without proving no data loss, reliability, or speed on the real release path.

## Test Sufficiency Verdict

The current tests are stronger at rejecting unsafe claims than they are at proving a safe release path.

What the tests do prove:

- `test/push-planner.test.js` covers planner refusal, live-remote precondition modeling, and conflict handling.
- `test/recovery-journal.test.js` covers restart classification, monotonic journaling, and redaction in a file-backed model.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` cover refusal of unsupported throughput claims.
- The `npm run test:playground:*` scripts cover several lab-backed route and storage slices.

What they do not prove:

- No data loss on a live WordPress source after a pull-base reuse, retry, replay, or mid-apply restart.
- Reliability across crash, duplicate request, stale claim, lease expiry, or fencing on the real storage and transport path.
- Speed on the production-shaped push path with a measured runtime and memory threshold.
- That one required command exists and is wired into CI as the default release gate.

The important distinction is that the suite is currently a blocker system, not an approver system. A green run can still stop short of the live-source boundary, which means the tests are necessary but not sufficient for release.

## Release Gate Acceptance Criteria

The missing release gate is only real proof if it does all of the following:

1. Runs from one required checked-in command, not from operator memory or script composition.
2. Fails on any `labBacked: true`, fixture-only, benchmark-only, or missing-live-source result.
3. Covers auth/session, durable journal, lease/fencing, graph identity, plugin-data-driver, real topology, crash-boundary, and benchmark evidence in one decision.
4. Is wired into CI or another default automation path so `npm test` and `npm run test:playground` remain evidence collectors only, not release approvers.

If any one of those items is absent, the objective is still blocked even if every opt-in smoke passes.

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source site after a pull, while that source may still be live and may have changed. The pull base is one-way and the push back to the source is one-way. The priorities are no data loss, reliable, and fast.

| ID | Requirement |
| --- | --- |
| R1 | Persist a complete one-way pull base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, protocol metadata, and enough scope evidence to prove what was and was not scanned. |
| R2 | Read the current live remote state before planning and compare base, local, and remote in a three-way plan before any one-way push back to the live source, with the live state rechecked again immediately before mutation. |
| R3 | Preserve remote-only changes by default, including deletes, plugin state, files, rows, and related resources. |
| R4 | Stop on local/remote conflicts with durable, redacted evidence that an operator can inspect and replay against the same pull base. |
| R5 | Apply every mutation only behind a live precondition that is rechecked immediately before the write and again after any staging boundary that can change the target. |
| R6 | Enforce storage-boundary guarded writes, or an equivalent compare-and-swap primitive, for every production DB and filesystem mutation. |
| R7 | Treat coupled file, DB, plugin, option, activation, and schema changes as atomic groups. Never report success for a split plugin/application state. |
| R8 | Reject plugin-owned, serialized, custom-table, or schema-sensitive data unless an explicit validator or semantic driver proves the mutation and its ownership scope. |
| R9 | Authenticate and authorize source-site mutation with production credentials, scoped push permissions, replay protection, and TLS outside local-only tests. |
| R10 | Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed remote state and cannot rely on dry-run receipts as locks. |
| R11 | Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery, and retain enough boundary evidence to explain every partially applied write. |
| R12 | Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, and operator retries. |
| R13 | Prove behavior against real WordPress data shapes: uploads, posts, postmeta, terms, users, options, plugin tables, plugin activation, schemas, and multisite if in scope. |
| R14 | Redact raw private data from plans, journals, conflict reports, recovery reports, and test artifacts. |
| R15 | Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard, with explicit runtime and memory targets, a documented measurement environment, and a release threshold that cannot be skipped by accident. Refusal-only benchmarks are not enough. |
| R16 | Provide one enforced release gate that runs the safety, recovery, auth/session, storage, plugin-data-driver, graph-identity, real topology, crash-boundary, and performance checks in a required order before any public or production claim is allowed. |

## Claim Audit

| Claim | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| No data loss | `test/push-planner.test.js` and `test/recovery-journal.test.js` prove planner refusal, protected local deletions, redaction, and restart classification in fixtures. The strongest route still labels itself `labBacked: true`, so the best visible success path is still lab-scoped. | It does not prove a live WordPress graph survives a failed push without losing or duplicating posts, postmeta, attachments, taxonomy links, menus, users, plugin-owned rows, or serialized plugin payloads. | `docs/recovery/apply-journal.md` and `docs/invariants/no-overwrite.md` describe the desired behavior only. | Live crash coverage at every guarded DB/file/plugin boundary and a production-backed no-loss assertion on the real source boundary. | Yes: indirect proof cannot clear the no-loss claim. |
| Reliability | The repo proves some journal, replay, stale-claim, and process-kill states are classified and blocked in local Playground fixtures, and the journal model rejects malformed states. `test/recovery-journal.test.js` is honest about being file-backed fixture evidence. | It does not prove restart safety, leases, fencing, rollback, or exactly-once behavior on a live source site across all mutation types and storage/transport failures. | `docs/recovery/apply-journal.md` and `docs/playground-topology.md` describe the intended flow only. | Production-backed kill matrix plus durable journal evidence on the real path. | Yes: fixture recovery does not prove production reliability. |
| Speed | `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove the repository refuses unsupported throughput claims and keeps benchmark evidence honest about what is missing. That is refusal proof, not a measured speed result. | It does not define a reproducible measurement contract, nor does it measure throughput or memory on a production-shaped executor or on a production-backed push path, so it cannot support a release claim that the path is fast. | `docs/fast-paths.md` and `docs/approach-scorecard.md` describe intended speedups and tradeoffs. | Measured end-to-end benchmark on the real push path with a stated threshold and memory ceiling. | Yes: no timed production benchmark means no speed claim. |
| Release gate | `package.json` exposes only `test`, `test:playground`, and separate opt-in smokes; there is no checked-in workflow file to force a default release path. The benchmark suite proves only refusal behavior and evidence invariants, so even the strongest test artifacts can still be bypassed by choosing a different command. | It does not have one required command that chains auth/session, durable journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and performance checks and fails closed when any one is still `labBacked: true`, fixture-scoped, or benchmark-only. | `README.md`, `docs/protocol.md`, and `docs/playground-topology.md` sketch the intended order and boundaries. | Missing enforced release gate and missing checked-in CI entrypoint to enforce it. | A green `npm test` or green `npm run test:playground` can still be mistaken for release approval even though neither proves the live boundary, and the repo has no `verify`, `release`, or `verify:release` script to remove that ambiguity. | Yes: every other claim remains bypassable until the gate exists, so the current automation surface is still opt-in rather than release-enforced. |

## Test Audit

The test suite is useful, but it does not yet prove the release claims it is most often associated with:

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves planner behavior, live-remote precondition modeling, and refusal on conflicts. It is indirect proof only: it does not execute a live remote mutation or recheck the source immediately before apply.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves file-backed journal monotonicity, redaction, and restart classification in fixtures. It does not prove production storage durability, lease handling, fencing, or process death recovery on the live source.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves benchmark shape and guardrail modeling. It does not time the real push path, measure memory, or establish a release threshold, so it is refusal scaffolding rather than throughput proof.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the repo refuses unsupported throughput claims and blocks tampered benchmark evidence. It does not prove a positive speed claim, so it cannot justify a "fast" release claim or stand in for a production benchmark.
- [`npm test`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) is a sanity check, not a release gate. Even when it passes, it is still blocker evidence because it cannot prove no data loss, reliability, or speed on the live source boundary.
- [`npm run test:playground`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) is a lab smoke chain, not a production approval path. Its strongest authenticated route still reports `labBacked: true`, so it remains lab evidence even when green.

The important distinction is that the suite can reliably prove failure modes and boundary refusals, but it still does not provide one executable success path at the live-source release boundary. That means the strongest current tests are blockers, not approvers: they can tell you when a claim is unsafe, but they cannot yet certify that the claim is safe enough to ship.

Current test verdict:

- Strong at refusal, fixture integrity, and modeled guardrails.
- Weak at proving live-source no-data-loss, production reliability, and measured speed.
- Insufficient as a release approval surface because it can still be bypassed by command choice.
- Specifically, the current suite proves local consistency and lab-scoped failure handling, but it does not prove a real live mutation boundary, a production durability path, or a measured production speed threshold.
- The green `npm test` result, even at 89 passing tests, remains blocker evidence only because it never becomes the single enforced release decision point.

Command verdict:

| Command | Status | Why it is not enough for release |
| --- | --- | --- |
| `npm test` | Executable proof of local model and fixture consistency | It never reaches the live-source boundary, so it cannot prove no data loss, reliability, or speed for production. |
| `npm run test:playground` | Lab/fixture proof | It chains lab routes only and still leaves the strongest authenticated route labeled `labBacked: true`. |
| `npm run test:playground:authenticated-http-push` | Lab/fixture proof | It is useful route-shape evidence, but the route profile still self-identifies as `labBacked: true`. |
| `npm run test:playground:production-shaped-push` | Lab/fixture proof | It looks production-shaped but still does not enforce the missing live-source release gate. |
| `npm run test:playground:production-plugin-package` | Lab/fixture proof | It exercises packaging and route shape, not the production storage and topology claims needed for release. |
| `npm run verify:release` | Missing proof | This is the required shape of the missing gate, but it does not exist yet. |

## Release Priority

The weakest current claim is the release gate, and that weakness propagates to every other claim. Until the repository has one mandatory command that composes the safety matrix, the suite can still produce green results without proving production readiness.

Highest-value next fix:

1. Add a mandatory `verify:release` entrypoint that rejects any `labBacked: true` or fixture-only proof.
2. Make that command the checked-in CI default.
3. Require the live-source, journal, lease/fencing, graph identity, plugin-driver, and benchmark checks to run in one enforced sequence.
4. Make the gate fail if the final proof set does not include a real remote/local topology, a durable journal on the production storage path, and a measured end-to-end benchmark with a stated threshold.
5. Make it impossible for `npm test` or `npm run test:playground` to satisfy the release bar on their own. If either command can clear release, the release bar is not enforced.
6. Treat any route that still self-identifies as `labBacked: true` as release-blocking, even if its shape looks production-like or its packaging step passes.

## Release Gate Gap

The repository currently has optional proof commands, not an enforced release gate. [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) confirms the split: the default suite is `npm test`, the bundled lab chain is `npm run test:playground`, and the stronger auth, journal, storage, recovery, plugin, and benchmark checks are only available as separate opt-ins. There is no `npm run release`, `npm run verify`, or `npm run verify:release`, and the checkout contains no `.github` workflow files, so there is no checked-in CI entrypoint to audit as a release gate. `npm test` and `npm run test:playground` are therefore evidence collectors, not approval commands. That means the best current evidence can still be selected piecemeal, which is exactly the failure mode the objective needs to eliminate.

A green run can therefore omit the exact proof the objective needs, even though the strongest route smokes still report `labBacked: true` and the benchmark suite only refuses unsupported throughput claims instead of timing a real push path. This is a release blocker, not a documentation gap: until one required command exists, the project can keep producing passing lab runs without proving production safety at the live remote/local boundary or a measured speed claim on the real push path. The weak claim is not that the tests are false; it is that they are not yet strong enough to clear release. In particular, `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` are still refusal proof, not performance proof: they demonstrate that unsupported throughput claims are blocked, but they do not establish a runtime, memory ceiling, or acceptance threshold for a production push path.

That is why the strongest current test evidence is still an audit artifact, not a release approval artifact.

Actionable release gate requirement:

1. Add one required command, such as `npm run verify:release`, that runs the auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real topology, crash-boundary, and benchmark checks in a fixed order.
2. Make that command exit non-zero if any step reports `labBacked: true`, fixture-only scope, skipped live-source proof, or an unsupported throughput claim.
3. Wire that command into CI or the release pipeline as the only accepted release entrypoint, and keep the optional smokes as contributors to that gate rather than as substitute release evidence.
4. Add a checked-in workflow or equivalent automation target that invokes the gate by default so a green CI result cannot come from `npm test` alone or from any lab-only subset of checks.
5. Make `npm test` and `npm run test:playground` explicitly insufficient for release so the default scripts cannot be mistaken for a production approval.
6. Require the gate to print which proof bucket failed last, so a pass/fail result is actionable instead of opaque.

Non-negotiable result: no release claim should be allowed until the gate exists and its failure mode is visible in the checked-in automation path, not just in local operator discipline.

Minimum acceptance rule for the gate:

- A green `npm test` or green `npm run test:playground` result must not be enough to clear release.
- The gate must fail if the proof set lacks a live remote/local topology, a durable journal on the real storage path, or a measured production-shaped speed result.
- If any subcheck is still a lab fixture, the release command must say so and stop.
- If the checked-in automation cannot invoke the gate by default, the release claim remains blocked even if every optional smoke passes.
- If the release command cannot name the last failing proof bucket, it is not actionable enough to be the release gate.

## Test Verdict

- The tests are good at proving conservative refusal behavior, fixture invariants, and some lab-scoped guarded-executor evidence.
- They do not prove the live-source push path preserves every WordPress data shape, survives production crash/retry boundaries, or meets a measured throughput target on the real push path.
- `test/push-planner.test.js` and `test/recovery-journal.test.js` still model the hardest cases in fixtures, but they stop short of proving the real source-site boundary, real storage durability, or a live lease/fencing regime.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` only prove that unsupported throughput claims are refused; they do not time an end-to-end production push, establish a release threshold, or prove the live source topology is fast. That makes them useful blocker tests, but they remain refusal proof rather than speed proof, and they cannot clear release while the strongest authenticated route still advertises `labBacked: true`. In other words, the benchmark surface is still a guardrail, not a speed claim, and nothing in this checkout turns it into a measured production benchmark.
- No current test in this checkout crosses the live WordPress source boundary and exercises the actual production mutation path end to end.
- `npm test` is therefore a valid sanity check, not a release approver.
- `npm run test:playground` is a useful lab smoke, not a proof of production safety.
- No current test in this checkout proves no data loss, reliability, or speed at the live source boundary. The suite can reject unsafe claims, but it still cannot certify the positive release claims the objective needs.
- The suite is evidence that release remains blocked, not evidence that release is safe.
- The strongest current proof is still split across optional commands and lab-labeled routes, so there is still no single required command that can convert the suite from blocker evidence into release evidence.
