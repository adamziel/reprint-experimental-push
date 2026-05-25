# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

## Derived Requirements

The objective implies the following minimum release requirements:

1. Pull the base one way, then push back to the live source one way.
2. Preserve all WordPress data shapes that can be affected by a push, including related rows, files, plugin-owned data, serialized payloads, and graph identity.
3. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes on the live push boundary.
4. Enforce auth, session, lease, fencing, durable journal, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts.
5. Prove the real remote/local topology, not just a local lab route shape, local Playground route, or fixture mount with the same hostname and different backing storage.
6. Either publish a measured speed claim or explicitly refuse to make one.
7. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, missing live-source proof, or benchmark-only.
8. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix.
9. Keep the optional smokes available for local evidence collection, but do not let them stand in for release proof.

Those requirements are the minimum release bar, not aspirational extras.

The weakest current requirement is the enforced release gate itself. The repo has many useful opt-in checks, but the objective is still blocked until one required command composes the safety matrix and fails closed when any claim is only lab-backed, fixture-scoped, or otherwise indirect. Right now [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) only exposes `test`, `test:playground`, and separate opt-in smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, and `test:playground:production-plugin-package`; `find .github -maxdepth 2 -type f` returns no checked-in workflow files in this checkout because there is no `.github` directory at all, so there is no visible CI entrypoint to enforce a default release path. A green run can still stop short of the production bar, which means the strongest available evidence can still be bypassed by choosing the wrong command. That is not a documentation gap; it is a missing release control, and until it exists every other proof bucket remains bypassable. The actionable fix is a single required gate such as `npm run verify:release`, wired into CI or the release pipeline, that refuses any lab-backed or fixture-only proof and is the only path that can support a release claim.

## Evidence Standard

Only executable evidence at the boundary being claimed counts as proof.

Design docs, model tests, and fixture smokes are useful, but they are indirect for production claims unless they exercise the same authentication, storage, journal, crash, concurrency, and WordPress data semantics that production will depend on.

For this audit:

- `Executable proof` means the test or command exercises the claimed behavior directly.
- `Lab/fixture proof` means the check is useful but still scoped to fixtures, local Playground, or a temporary package route.
- `Docs-only proof` means the claim appears in prose, script names, or diagrams, but not in a required executable gate.
- `Release blocker` means the objective still fails closed until stronger proof exists.

## Evidence Table

| Requirement | Executable proof | Lab/fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, one-way push to live source | Planner and fixture smokes reject unsafe overwrites and preserve remote-only changes. | Local Playground push flows and protocol fixtures approximate the live boundary. | `README.md`, `docs/protocol.md`, and `docs/playground-topology.md` describe the intended flow. | A live-source push boundary that mutates the actual source site after a pull-base snapshot. | Yes: the only direct push proof is still lab-backed. |
| Preserve all affected WordPress data shapes | Model and fixture tests cover selected rows, files, plugin-owned records, and graph-safe conflicts. | File and DB fixture checks exercise some data shapes and redaction paths. | `docs/recovery/acceptable-states.md` and `docs/invariants/no-overwrite.md` describe the desired data shapes. | Exhaustive live-source coverage for arbitrary DB rows, files, plugin-owned data, graph identity, and same-plan rewrites. | Yes: indirect coverage is not enough. |
| Survive crash/retry/replay/duplicate/stale-claim/lease-expiry cases | Process-kill, stale-claim, idempotency, and replay smokes exist. | Recovery and journal tests model restart states and append semantics. | `docs/recovery/apply-journal.md` describes the intended recovery contract. | Production-backed journal durability, lease/fencing behavior, and crash recovery on the real storage and transport path. | Yes: recovery is still fixture-scoped. |
| Enforce auth/session/lease/fencing/journal/graph identity/plugin-driver checks | Authenticated local Playground routes, DB journal slices, and graph assertions exist in lab scope. | Script-level smokes and benchmark model checks refuse some unsafe shortcuts. | `docs/executor.md`, `docs/protocol.md`, and `fixtures/protocol/*` describe the checks. | A required production release gate that enforces all of them together. | Yes: no enforced gate exists. |
| Prove real remote/local topology | Playground blueprints, local HTTP route smokes, and authenticated lab routes approximate the topology. | Local ingress on port 8080 and the lab server topology are exercised. | `docs/playground-topology.md` documents the intended topology. | Evidence from the actual remote/local production topology with a live source and live push target. | Yes: topology proof remains lab-only. |
| Publish or refuse a speed claim | Benchmark refusal tests block unsupported throughput claims, and the model tracks the proof obligations that a claim would need. | The benchmark model encodes gating, backpressure, and refusal states. | `docs/fast-paths.md` and `docs/approach-scorecard.md` discuss intended speedups. | A measured runtime or memory result from the production-shaped push path, with stated thresholds and a repeatable measurement contract. | Yes: speed is still refusal-only, not measured production proof. |
| Expose one required release command | Optional npm scripts and opt-in smokes exist: `npm test` is just `node --test`, `npm run test:playground` fans out to plan/apply/push-protocol, and the extra scenario commands in `package.json` remain individually callable. | There are many safety-oriented checks, but they remain individually optional. | Script names and comments imply a desired release sequence. | A mandatory `verify:release`-style entrypoint that fails closed instead of letting operators assemble only the easy checks. | Yes: there is no required gate. |
| Wire the release command into CI or an equivalent enforced entrypoint | `npm test` and `npm run test:playground` prove local invariants and lab flows. | No checked-in workflow file or equivalent default release target is present in this checkout; `find .github -maxdepth 3 -type f` returns nothing because `.github` is absent. | `package.json` and the absence of `.github` are the only visible automation clues. | A single checked-in release path that includes auth/session, durable journal, lease/fencing, graph identity, plugin-driver, real topology, crash-boundary, recovery, and benchmark checks. | Yes: the strongest checks are still opt-in and there is no workflow file to enforce a default run. |

## Test Audit

The current tests are strongest where they reject unsafe claims, and weakest where they are asked to prove production release safety on the live push path. Their strongest value today is as refusal evidence, not as release evidence.

- `npm test` proves the model and selected fixture logic are internally consistent. It does not prove live source mutation, production storage, or a live WordPress graph, so it cannot support the no-data-loss claim by itself.
- `npm run test:playground` proves a bundled lab path through plan/apply/push protocol. It does not invoke the stronger auth, journal, storage, recovery, plugin, graph, or benchmark gates, so it cannot support the reliability claim by itself.
- `npm run test:playground:production-shaped-push` and `npm run test:playground:production-plugin-package` prove route shape and packaging behavior. They still report `labBacked: true`, so they are explicitly not production proof and cannot be used as release evidence for speed, durability, real credential lifecycle, or live-source topology.
- `npm run test:playground:authenticated-http-push` and `npm run test:playground:authenticated-cli-push` exercise auth flows, but only in lab topology; they do not prove source-site credentials, TLS-bound session lifecycle, leases, or fenced writes on the live remote/local boundary.
- The journal and recovery smokes are stronger than plain model tests, but they still run against local fixtures and cannot on their own prove durable production storage or a real crash boundary.
- `test/recovery-journal.test.js` proves file-backed JSONL append/restart behavior, monotonic sequences, no raw journal values, and restart classification. It does not prove production storage durability, cross-process lease handling, a live remote/local crash boundary, or any production WordPress mutation path, so it is proof of a journal model rather than proof of the live storage path.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove the benchmark model keeps proof obligations attached to the proposed fast paths and that unsupported throughput claims are blocked. They do not measure a production push path, establish a real runtime/memory threshold, or prove that the live source topology is fast, so they support refusal of unsupported speed claims rather than a release-speed claim.
- All of the optional smokes can pass at once and still leave the objective blocked, because none of them is mandatory and none of them is the single enforced decision point the release bar needs.
- In practical terms, the suite currently proves "we refuse to overclaim" much better than it proves "we can safely release."

The uncomfortable conclusion is that the suite proves guardrails, not release safety. If the release claim depends on no data loss, reliability, or speed, the current tests are still missing the only evidence that would make those claims credible:

- a live-source push that mutates the real target after a pull-base snapshot;
- a durable production journal on the real storage path;
- a real lease/fencing boundary that prevents concurrent or stale writers;
- a measured end-to-end benchmark on the production-shaped push path with a stated threshold;
- one enforced gate that fails closed when any of the above is still fixture-only or refusal-only.

## Test Claim Audit

What the current tests actually prove:

- `test/push-planner.test.js` proves the planner and executor model reject stale identities, preserve fixture invariants, and attach recovery evidence when a failure is injected.
- `test/recovery-journal.test.js` proves the file-backed journal keeps monotonic records, redacts raw values, and classifies restart-inspectable failure states in the journal model.
- `test/performance-model.test.js` proves the benchmark model encodes the intended gates, refusal states, and safe-speedup guardrails.
- `test/guarded-executor-benchmark.test.js` proves unsupported throughput claims are refused when the model reports missing durable evidence.

What they do not prove:

- They do not prove a production WordPress source site keeps rows, uploads, and plugin-owned data intact through a live push.
- They do not prove production auth/session, lease/fencing, or durable journal storage on the real transport path.
- They do not prove recovery after a real process death or duplicated request against a live source site.
- They do not prove speed for the live boundary because no required benchmark runs there, and no enforced gate requires that proof.

That is why the suite remains a proof of refusal and local safety modeling, not a proof of release readiness.

## Evidence Ledger

| Bucket | Current evidence | What it proves | What it does not prove |
| --- | --- | --- | --- |
| Executable proof | `npm test`, `test/push-planner.test.js`, `test/recovery-journal.test.js`, `test/performance-model.test.js`, `test/guarded-executor-benchmark.test.js` | Planner invariants, recovery classifications, redaction rules, refusal logic, and model-level safety constraints | Live source mutation, production topology, durable production storage, or measured speed on the release path |
| Lab/fixture proof | `npm run test:playground`, `npm run test:playground:authenticated-http-push`, `npm run test:playground:authenticated-cli-push`, `npm run test:playground:db-journal-idempotency`, `npm run test:playground:storage-guarded-db-write`, `npm run test:playground:storage-guarded-file-write`, `npm run test:playground:mid-apply-drift`, `npm run test:playground:db-journal-process-kill`, `npm run test:playground:db-journal-missing-commit-finalization`, `npm run test:playground:db-journal-stale-claim-all-old`, `npm run test:playground:recovery`, `npm run test:playground:production-shaped-push`, `npm run test:playground:production-plugin-package`, `npm run test:playground:plugin-atomic-install`, `npm run test:playground:http-push`, `npm run test:playground:forms-lab-table` | Useful end-to-end slices through local Playground, route shape, journal behavior, drift handling, and fixture storage guards | Production WordPress semantics, durable production storage, live-source auth/session, or lease/fencing enforcement |
| Docs-only proof | `README.md`, `docs/*`, script names, and comments | The intended release bar, data-loss concerns, and desired check ordering are described | No executable proof that the described release bar is actually enforced |
| Missing proof | [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) has no required `verify:release`-style command; `find .github -maxdepth 3 -type f` returns no workflow files because this checkout has no `.github` directory, so there is no visible CI entrypoint that composes auth/session, journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and benchmark checks. | Nothing by itself; this bucket marks the gap. | The objective still lacks a single required release gate that fails closed when any safety proof remains optional, and there is no checked-in automation to prevent a green default run from bypassing the hardest checks. |
| Release blocker | The best evidence still says `labBacked: true` for the production-shaped route/package smokes, the benchmark path remains refusal-only, and the strongest checks are still opt-in scripts rather than one enforced release path. | Honest refusal to overclaim release readiness | Production no-data-loss, reliability, and speed remain unproven until the missing gate and live-source evidence exist, so the release claim still fails closed. |

## Explicit Requirements From The Objective

The objective is to push local changes back to the original WordPress source site after a pull, while that source may still be live and may have changed. The pull base is one-way and the push back to the source is one-way. The priorities are no data loss, reliable, and fast.

| ID | Requirement |
| --- | --- |
| R1 | Persist a complete one-way pull base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, protocol metadata, and enough scope evidence to prove what was and was not scanned. |
| R2 | Read the current live remote state before planning and compare base, local, and remote in a three-way plan before any one-way push back to the live source. |
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
| R15 | Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard, with explicit runtime and memory targets, a documented measurement environment, and a release threshold that cannot be skipped by accident. |
| R16 | Provide one enforced release gate that runs the safety, recovery, auth/session, storage, plugin-data-driver, graph-identity, real topology, crash-boundary, and performance checks in a required order before any public or production claim is allowed. |

## Claim Audit

| Claim | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| No data loss | The repo proves selected planner rules, fixture-scoped protected writes, replay refusal, and a production-shaped lab route that still reports `labBacked: true`. | It does not prove a live WordPress graph survives a failed push without losing or duplicating posts, postmeta, attachments, taxonomy links, menus, users, plugin-owned rows, or serialized plugin payloads. | Missing live crash coverage at every guarded DB/file/plugin boundary. |
| Reliability | The repo proves some journal, replay, stale-claim, and process-kill states are classified and blocked in local Playground fixtures. | It does not prove restart safety, leases, fencing, rollback, or exactly-once behavior on a live source site across all mutation types. | Missing production-backed kill matrix plus durable journal evidence. |
| Speed | The repo proves benchmark guards and model checks exist, and the benchmark harness fails closed on unsupported throughput claims. `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` only assert refusal and model invariants, not a timed production push. | It does not define a reproducible measurement contract, nor does it measure throughput or memory on a production-shaped executor or on a production-backed push path, so it cannot support a release claim that the path is fast. | Missing measured end-to-end benchmark on the real push path with a release threshold. |
| Release gate | `package.json` exposes only `test`, `test:playground`, and separate opt-in smokes; there is no checked-in workflow file to force a default release path. | It does not have one required command that chains auth/session, durable journal, storage, graph identity, plugin-data-driver, real topology, crash-boundary, recovery, and performance checks and fails closed when any one is still lab-backed, fixture-scoped, or benchmark-only. | Missing enforced release gate, so all other claims remain bypassable. |

## Release Priority

The weakest current claim is the release gate, and that weakness propagates to every other claim. Until the repository has one mandatory command that composes the safety matrix, the suite can still produce green results without proving production readiness.

Highest-value next fix:

1. Add a mandatory `verify:release` entrypoint that rejects any `labBacked: true` or fixture-only proof.
2. Make that command the checked-in CI default.
3. Require the live-source, journal, lease/fencing, graph identity, plugin-driver, and benchmark checks to run in one enforced sequence.

## Release Gate Gap

The repository currently has optional proof commands, not an enforced release gate. [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33) confirms the split: the default suite is `npm test`, the bundled lab chain is `npm run test:playground`, and the stronger auth, journal, storage, recovery, plugin, and benchmark checks are only available as separate opt-ins. There is no `npm run release`, `npm run verify`, or `npm run verify:release`, and this checkout has no checked-in `.github` workflow files, so there is no CI entrypoint to audit as a release gate. That means the best current evidence can still be selected piecemeal, which is exactly the failure mode the objective needs to eliminate.

A green run can therefore omit the exact proof the objective needs, even though the strongest route smokes still report `labBacked: true` and the benchmark suite only refuses unsupported throughput claims instead of timing a real push path. This is a release blocker, not a documentation gap: until one required command exists, the project can keep producing passing lab runs without proving production safety at the live remote/local boundary or a measured speed claim on the real push path. The weak claim is not that the tests are false; it is that they are not yet strong enough to clear release.

Actionable release gate requirement:

1. Add one required command, such as `npm run verify:release`, that runs the auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real topology, crash-boundary, and benchmark checks in a fixed order.
2. Make that command exit non-zero if any step reports `labBacked: true`, fixture-only scope, skipped live-source proof, or an unsupported throughput claim.
3. Wire that command into CI or the release pipeline as the only accepted release entrypoint, and keep the optional smokes as contributors to that gate rather than as substitute release evidence.
4. Add a checked-in workflow or equivalent automation target that invokes the gate by default so a green CI result cannot come from `npm test` alone or from any lab-only subset of checks.

Non-negotiable result: no release claim should be allowed until the gate exists and its failure mode is visible in the checked-in automation path, not just in local operator discipline.

Minimum acceptance rule for the gate:

- A green `npm test` or green `npm run test:playground` result must not be enough to clear release.
- The gate must fail if the proof set lacks a live remote/local topology, a durable journal on the real storage path, or a measured production-shaped speed result.
- If any subcheck is still a lab fixture, the release command must say so and stop.

## Test Verdict

- The tests are good at proving conservative refusal behavior and fixture invariants.
- They do not prove the live-source push path preserves every WordPress data shape, survives production crash/retry boundaries, or meets a measured throughput target.
- So the suite is evidence that release remains blocked, not evidence that release is safe.
