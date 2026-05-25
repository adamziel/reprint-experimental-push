# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

## Derived Requirements

The objective implies the following minimum release requirements:

1. Pull the base one way, then push back to the live source one way, with the live source rechecked at apply time.
2. Preserve every WordPress data shape a push can affect, including related rows, files, plugin-owned data, serialized payloads, and graph identity.
3. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary, with the same behavior enforced on the real production storage and transport path.
4. Enforce auth, session, lease, fencing, durable journal, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts.
5. Prove the real remote/local topology, not just a local lab route shape, local Playground route, or fixture mount with the same hostname and different backing storage.
6. Either publish a measured speed claim from the live push path or explicitly refuse to make one.
7. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, missing live-source proof, or benchmark-only.
8. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix.
9. Keep the optional smokes available for local evidence collection, but do not let them stand in for release proof.

Those requirements are the minimum release bar, not aspirational extras.

The weakest current requirement is the enforced release gate itself. The repo has many useful opt-in checks, but the objective is still blocked until one required command composes the safety matrix and fails closed when any claim is only lab-backed, fixture-scoped, benchmark-only, or otherwise indirect. Right now [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) only exposes `test`, `test:playground`, and separate opt-in smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, and `test:playground:production-plugin-package`; there is still no `verify`, `release`, or `verify:release` script. This checkout also has no checked-in `.github` workflow files, so there is no visible CI entrypoint to enforce a default release path. A green run can still stop short of the production bar, which means the strongest available evidence can still be bypassed by choosing the wrong command. That is not a documentation gap; it is a missing release control, and until it exists every other proof bucket remains bypassable. The actionable fix is a single required gate, such as `npm run verify:release`, wired into CI or the release pipeline, that refuses any lab-backed or fixture-only proof and is the only path that can support a release claim. The gate must be evaluated from the checked-in default automation path, not from operator memory or manual script composition. A production-shaped route is not enough on its own if the authenticated implementation still reports `labBacked: true`, and the absence of a checked-in workflow means the release control is not just unimplemented but unenforced. In practical terms, `npm test` and `npm run test:playground` are currently permissible evidence collectors, not release approvers.

Concrete release-gate evidence today:

- `npm test` is only `node --test`; it does not compose the release matrix.
- `npm run test:playground` only chains `plan`, `apply`, and `push-protocol`; it does not require auth/session, journal durability, leases/fencing, graph identity, plugin-driver, real topology, crash-boundary, or benchmark proof.
- The stronger checks are individually callable, but nothing forces them to run together before a release claim.
- No checked-in workflow file exists in this checkout, so there is no default CI path to enforce the missing gate.
- The strongest authenticated route still self-identifies as `labBacked: true`, so even a successful smoke is labeled as lab evidence rather than release evidence.

The current lab/prod boundary is also explicit in code. [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js#L60-L74) still marks the authenticated route profile as `labBacked: true`, and that flag feeds the strongest authenticated push smoke. So even the best-looking push path is still self-described as lab evidence, not release evidence. That is useful for honest labeling, but it is also the clearest sign that the release claim cannot yet rest on that flow. Until a non-lab-backed path exists and is required by policy, the objective remains blocked.

## Evidence Standard

Only executable evidence at the boundary being claimed counts as proof. Fixture passes, lab backends, refusal-only tests, and `labBacked: true` route labels are useful for honest scoping, but they do not clear a production release claim unless they exercise the same boundary that the claim names.

Design docs, model tests, and fixture smokes are useful, but they are indirect for production claims unless they exercise the same authentication, storage, journal, crash, concurrency, and WordPress data semantics that production will depend on.

A test that only proves refusal, redaction, or route shape is still indirect for affirmative claims about no data loss, reliability, or speed.

For this audit:

- `Executable proof` means the test or command exercises the claimed behavior directly at the claimed boundary.
- `Lab/fixture proof` means the check is useful but still scoped to fixtures, local Playground, or a temporary package route.
- `Docs-only proof` means the claim appears in prose, script names, or diagrams, but not in a required executable gate.
- `Release blocker` means the objective still fails closed until stronger proof exists.

## Evidence Table

| Requirement | Executable proof | Lab/fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, one-way push to live source | Planner and fixture smokes reject unsafe overwrites and preserve remote-only changes in modeled sites. | Local Playground push flows and protocol fixtures approximate the live boundary, but they still do not mutate the actual source site. | `README.md`, `docs/protocol.md`, and `docs/playground-topology.md` describe the intended flow. | A live-source push boundary that mutates the actual source site after a pull-base snapshot and rechecks the live source at apply time. | Yes: no executable evidence reaches the live source boundary. |
| Preserve all affected WordPress data shapes | Model and fixture tests cover selected rows, files, plugin-owned records, serialized payload shapes, and graph-safe conflicts. | File and DB fixture checks exercise some data shapes and redaction paths, but only in controlled lab state. | `docs/recovery/acceptable-states.md` and `docs/invariants/no-overwrite.md` describe the desired data shapes. | Exhaustive live-source coverage for arbitrary DB rows, files, plugin-owned data, serialized payloads, graph identity, and same-plan rewrites. | Yes: indirect coverage cannot prove no-loss behavior. |
| Survive crash/retry/replay/duplicate/stale-claim/lease-expiry cases | Process-kill, stale-claim, idempotency, and replay smokes exist. | Recovery and journal tests model restart states and append semantics, but not on the real production storage and transport path. | `docs/recovery/apply-journal.md` describes the intended recovery contract. | Production-backed journal durability, lease/fencing behavior, and crash recovery on the real storage and transport path. | Yes: the crash matrix is still fixture-scoped. |
| Enforce auth/session/lease/fencing/journal/graph identity/plugin-driver checks | Authenticated local Playground routes, DB journal slices, graph assertions, and refusal-focused benchmark checks exist in lab scope. | Script-level smokes prove some guards fail closed, but only inside optional commands and fixture/lab backends. | `docs/executor.md`, `docs/protocol.md`, and `fixtures/protocol/*` describe the checks. | A required production release gate that enforces all of them together on the live boundary and rejects any `labBacked: true` proof. | Yes: the checks are split across optional commands only, so the gate is still missing. |
| Prove real remote/local topology | Playground blueprints, local HTTP route smokes, and authenticated lab routes approximate the topology. | Local ingress on port 8080 and the lab server topology are exercised. | `docs/playground-topology.md` documents the intended topology. | Evidence from the actual remote/local production topology with a live source and live push target. | Yes: topology proof remains lab-only. |
| Publish or refuse a speed claim | Benchmark refusal tests block unsupported throughput claims, and the model tracks the proof obligations that a claim would need. | The benchmark model encodes gating, backpressure, and refusal states, but it does not time the live push path. | `docs/fast-paths.md` and `docs/approach-scorecard.md` discuss intended speedups. | A measured runtime or memory result from the production-shaped push path, with stated thresholds, a repeatable measurement contract, and an enforced release threshold. | Yes: speed is still refusal-only, not measured production proof. |
| Expose one required release command | Optional npm scripts and opt-in smokes exist: `npm test` is just `node --test`; `npm run test:playground` fans out only to `test:playground:plan`, `test:playground:apply`, and `test:playground:push-protocol`; the stronger checks remain individually callable through `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:production-plugin-package`, `test:playground:db-journal-idempotency`, `test:playground:storage-guarded-db-write`, `test:playground:storage-guarded-file-write`, `test:playground:mid-apply-drift`, `test:playground:db-journal-process-kill`, `test:playground:db-journal-missing-commit-finalization`, `test:playground:db-journal-stale-claim-all-old`, `test:playground:recovery`, `test:playground:forms-lab-table`, and `test:recovery:file-journal`. | The strongest auth and push smokes still advertise `labBacked: true`, so even the best current path self-identifies as lab evidence rather than release evidence. | Script names and comments imply a desired release sequence. | A mandatory `verify:release`-style entrypoint that fails closed instead of letting operators assemble only the easy checks or trust a green lab-only default. | Yes: there is still no required gate, and `package.json` has no `verify`, `release`, or `verify:release` script to enforce one. |
| Wire the release command into CI or an equivalent enforced entrypoint | `npm test` and `npm run test:playground` prove local invariants and lab flows, but only within opt-in commands. | No checked-in workflow file or equivalent default release target is present in this checkout; `.github` is absent, so there is no default CI path to inspect or enforce. | `package.json` and the absence of `.github` are the only visible automation clues. | A single checked-in release path that includes auth/session, durable journal, lease/fencing, graph identity, plugin-driver, real topology, crash-boundary, recovery, and benchmark checks. | Yes: the strongest checks are still opt-in and there is no workflow file or other checked-in automation to enforce a default run. |

## Test Audit

The current tests are strongest where they reject unsafe claims, and weakest where they are asked to prove production release safety on the live push path. Their strongest value today is as refusal evidence, not as release evidence. They demonstrate that the suite knows how to say "not yet"; they do not demonstrate that the production boundary is safe.
That is not a small wording issue. The suite can falsify bad claims, but it still cannot certify the good claims the objective needs because the strongest push path remains labeled `labBacked: true`, the recovery tests stay fixture-scoped, and the benchmark checks stop at refusal rather than timing a real live-source push.

That distinction matters for the objective claims:

- No-data-loss is not proven unless the test reaches the live source boundary and verifies that every affected WordPress shape survives a failed or retried push.
- Reliability is not proven unless the suite exercises real crash, retry, stale-claim, and lease/fencing behavior on the real storage and transport path.
- Speed is not proven unless the suite measures the production-shaped push path against a stated threshold and memory ceiling; refusal-only benchmark tests do not count as performance proof.

- `npm test` proves the model and selected fixture logic are internally consistent. It does not prove live source mutation, production storage, or a live WordPress graph, so it cannot support the no-data-loss claim by itself.
- `npm run test:playground` proves a bundled lab path through plan/apply/push protocol. It does not invoke the stronger auth, journal, storage, recovery, plugin, graph, or benchmark gates, so it cannot support the reliability claim by itself.
- `test/recovery-journal.test.js` proves restart classification, monotonic sequencing, and raw-value redaction in a file-backed journal model. It does not prove durable production storage, lease/fencing behavior, or crash recovery on the live source boundary.
- `npm run test:playground:authenticated-http-push`, `npm run test:playground:authenticated-cli-push`, `npm run test:playground:production-shaped-push`, and `npm run test:playground:production-plugin-package` are the closest release-shaped smokes, but they are still route-shape and packaging evidence. The code still marks the authenticated route profile as `labBacked: true`, so these checks remain explicit lab proof rather than live production proof.
- The stronger scripts in `package.json` are all opt-in and still separate: auth, production-shaped route/package, db journal, storage guards, process-kill, missing-finalization, stale-claim, recovery, forms table, and file-journal checks can each pass independently while the release bar remains unmet.
- `test/push-planner.test.js` and `test/recovery-journal.test.js` prove planner invariants, redaction, sequence monotonicity, and restart classifications in fixtures. They do not prove a live WordPress source site survives a failed push, a restart, or a duplicated request without data loss.
- `test/playground-snapshot-lib.test.js` proves the PHP helper rejects unsupported fixture resources and table names. That is useful input validation, not release evidence for production plugin data drivers or live graph identity.
- `test/performance-model.test.js` proves the benchmark model keeps proof obligations attached to the proposed fast paths and that unsupported throughput claims are blocked. `test/guarded-executor-benchmark.test.js` proves the refusal path on tampered evidence. Together they prove refusal discipline, not speed. They do not measure a production push path, set an actual runtime or memory threshold, or prove that the live source topology is fast.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` are therefore blocker tests, not release-speed evidence. They can tell you when a throughput claim is unsupported, but they cannot tell you that the live push path is actually fast enough to ship.
- Their refusal behavior is only a guardrail. It proves the suite can reject unsupported speed claims, but it does not define a measured runtime, memory ceiling, or release threshold for the production-shaped path.
- The authenticated push smokes are still labeled `labBacked: true`, so even a green run there is a lab pass, not release proof.
- All of the optional smokes can pass at once and still leave the objective blocked, because none of them is mandatory, none of them is the single enforced decision point the release bar needs, and there is no checked-in CI workflow to force a default release path.
- The current test surface is therefore honest about risk, but honesty is not enough: it proves that the suite can refuse unsafe claims, not that the live release path is safe.
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
- The `npm run test:playground:*` scripts prove several lab-shaped route and storage slices, but they remain optional and do not collapse into one enforced release decision.

What they do not prove:

- They do not prove a production WordPress source site keeps rows, uploads, and plugin-owned data intact through a live push.
- They do not prove production auth/session, lease/fencing, or durable journal storage on the real transport path.
- They do not prove recovery after a real process death or duplicated request against a live source site.
- They do not prove speed for the live boundary because no required benchmark runs there, and no enforced gate requires that proof.
- They do not prove that any single green command is sufficient for release, because the evidence is still split across optional commands.

That is why the suite remains a proof of refusal and local safety modeling, not a proof of release readiness.
The uncomfortable but useful reading is that the suite is more trustworthy as a blocker than as an approver.

## Evidence Ledger

| Bucket | Current evidence | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Executable proof | `npm test`, `test/push-planner.test.js`, `test/recovery-journal.test.js`, `test/performance-model.test.js`, `test/guarded-executor-benchmark.test.js` | Planner invariants, recovery classifications, redaction rules, refusal logic, and model-level safety constraints | Live source mutation, production topology, durable production storage, or measured speed on the release path |
| Lab/fixture proof | `npm run test:playground`, `npm run test:playground:authenticated-http-push`, `npm run test:playground:authenticated-cli-push`, `npm run test:playground:db-journal-idempotency`, `npm run test:playground:storage-guarded-db-write`, `npm run test:playground:storage-guarded-file-write`, `npm run test:playground:mid-apply-drift`, `npm run test:playground:db-journal-process-kill`, `npm run test:playground:db-journal-missing-commit-finalization`, `npm run test:playground:db-journal-stale-claim-all-old`, `npm run test:playground:recovery`, `npm run test:playground:production-shaped-push`, `npm run test:playground:production-plugin-package`, `npm run test:playground:plugin-atomic-install`, `npm run test:playground:http-push`, `npm run test:playground:forms-lab-table` | Useful end-to-end slices through local Playground, route shape, journal behavior, drift handling, and fixture storage guards | Production WordPress semantics, durable production storage, live-source auth/session, or lease/fencing enforcement |
| Docs-only proof | `README.md`, `docs/*`, script names, and comments | The intended release bar, data-loss concerns, and desired check ordering are described | No executable proof that the described release bar is actually enforced |
| Missing proof | [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) has no required `verify:release`-style command; this checkout has no `.github` directory, so there is no visible CI entrypoint that composes auth/session, journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and benchmark checks. | Nothing by itself; this bucket marks the gap. | The objective still lacks a single required release gate that fails closed when any safety proof remains optional, and there is no checked-in automation to prevent a green default run from bypassing the hardest checks. `npm test` and `npm run test:playground` therefore remain insufficient by design. |
| Release blocker | The best evidence still says `labBacked: true` for the production-shaped route/package smokes, the benchmark path remains refusal-only, and the strongest checks are still opt-in scripts rather than one enforced release path. | Honest refusal to overclaim release readiness | Production no-data-loss, reliability, and speed remain unproven until the missing gate and live-source evidence exist, so the release claim still fails closed. |
| Release blocker | [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js#L60-L74) still self-identifies the authenticated push profile as `labBacked: true`, and [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) still exposes only opt-in scripts. | Honest refusal to overclaim release readiness | The release claim still fails closed because the strongest visible authenticated flow remains lab-labeled and there is still no enforced release gate to stop a green default run from bypassing the missing proof. |

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
| No data loss | The repo proves selected planner rules, fixture-scoped protected writes, replay refusal, and a production-shaped lab route that still reports `labBacked: true`. | It does not prove a live WordPress graph survives a failed push without losing or duplicating posts, postmeta, attachments, taxonomy links, menus, users, plugin-owned rows, or serialized plugin payloads. | Missing live crash coverage at every guarded DB/file/plugin boundary. |
| Reliability | The repo proves some journal, replay, stale-claim, and process-kill states are classified and blocked in local Playground fixtures. | It does not prove restart safety, leases, fencing, rollback, or exactly-once behavior on a live source site across all mutation types. | Missing production-backed kill matrix plus durable journal evidence. |
| Speed | The repo proves benchmark guards and model checks exist, and the benchmark harness fails closed on unsupported throughput claims. `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` still only prove refusal and model invariants, not a timed production push. | It does not define a reproducible measurement contract, nor does it measure throughput or memory on a production-shaped executor or on a production-backed push path, so it cannot support a release claim that the path is fast. | Missing measured end-to-end benchmark on the real push path with a release threshold. |
| Release gate | `package.json` exposes only `test`, `test:playground`, and separate opt-in smokes; there is no checked-in workflow file to force a default release path. The benchmark suite proves only refusal behavior and evidence invariants, so even the strongest test artifacts can still be bypassed by choosing a different command. | It does not have one required command that chains auth/session, durable journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and performance checks and fails closed when any one is still lab-backed, fixture-scoped, or benchmark-only. | Missing enforced release gate, so all other claims remain bypassable. |

## Release Priority

The weakest current claim is the release gate, and that weakness propagates to every other claim. Until the repository has one mandatory command that composes the safety matrix, the suite can still produce green results without proving production readiness.

Highest-value next fix:

1. Add a mandatory `verify:release` entrypoint that rejects any `labBacked: true` or fixture-only proof.
2. Make that command the checked-in CI default.
3. Require the live-source, journal, lease/fencing, graph identity, plugin-driver, and benchmark checks to run in one enforced sequence.
4. Make the gate fail if the final proof set does not include a real remote/local topology, a durable journal on the production storage path, and a measured end-to-end benchmark with a stated threshold.
5. Make it impossible for `npm test` or `npm run test:playground` to satisfy the release bar on their own. If either command can clear release, the release bar is not enforced.

## Release Gate Gap

The repository currently has optional proof commands, not an enforced release gate. [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) confirms the split: the default suite is `npm test`, the bundled lab chain is `npm run test:playground`, and the stronger auth, journal, storage, recovery, plugin, and benchmark checks are only available as separate opt-ins. There is no `npm run release`, `npm run verify`, or `npm run verify:release`, and `find .github -maxdepth 3 -type f` returns no workflow files in this checkout, so there is no checked-in CI entrypoint to audit as a release gate. That means the best current evidence can still be selected piecemeal, which is exactly the failure mode the objective needs to eliminate.

A green run can therefore omit the exact proof the objective needs, even though the strongest route smokes still report `labBacked: true` and the benchmark suite only refuses unsupported throughput claims instead of timing a real push path. This is a release blocker, not a documentation gap: until one required command exists, the project can keep producing passing lab runs without proving production safety at the live remote/local boundary or a measured speed claim on the real push path. The weak claim is not that the tests are false; it is that they are not yet strong enough to clear release. In particular, `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` are still refusal proof, not performance proof: they demonstrate that unsupported throughput claims are blocked, but they do not establish a runtime, memory ceiling, or acceptance threshold for a production push path.

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

## Test Verdict

- The tests are good at proving conservative refusal behavior, fixture invariants, and some lab-scoped guarded-executor evidence.
- They do not prove the live-source push path preserves every WordPress data shape, survives production crash/retry boundaries, or meets a measured throughput target on the real push path.
- `test/push-planner.test.js` and `test/recovery-journal.test.js` still model the hardest cases in fixtures, but they stop short of proving the real source-site boundary, real storage durability, or a live lease/fencing regime.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` only prove that unsupported throughput claims are refused; they do not time an end-to-end production push, establish a release threshold, or prove the live source topology is fast. That means they are appropriate as blocker tests, but insufficient as the evidence for a release-speed claim, and they cannot clear release while the strongest authenticated route still advertises `labBacked: true`.
- Together, those benchmark tests prove the repository is careful about overclaiming speed, but they still leave the objective's speed requirement entirely unproven because no required test measures the live source boundary.
- So the suite is evidence that release remains blocked, not evidence that release is safe.
