# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The blocker is structural: there is no mandatory command that proves the one-way pull base plus one-way push back to the live source on the real storage and transport path. `node --test` passes, but the passing subtests are still fixture-, model-, or lab-backed, and `package.json` exposes only `test`, `plan`, `apply`, and optional `test:playground:*` helpers. There is no checked-in `verify`, `verify:release`, or `release` command, and there is no `.github/workflows/` entrypoint in this checkout to compensate. The strongest production-shaped smokes still self-identify as `labBacked: true`, so they remain lab proof rather than live-source proof. The benchmark surface is also explicit: it reports `productionThroughput: 'not-claimed'`, and the guarded benchmark tests refuse to upgrade that into a claim. That is refusal evidence, not release proof. Until a required gate reaches the live-source boundary, rechecks apply-time state, and emits a machine-checkable verdict, `speed unclaimed` is the only defensible production-facing wording. No current green run can legitimately be read as proof that writes are lossless, that the live push path is reliable under crash/retry/replay, or that production speed has been measured.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not bidirectional.
2. Recheck the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve every WordPress data shape the push can touch, including rows, files, plugin-owned data, serialized payloads, and graph identity, at the live-source boundary.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary.
5. Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes. The current `package.json` does not define a required `verify`, `verify:release`, or `release` command, so there is no mandatory gate that composes those checks into one verdict. Optional scripts such as `test:playground:*` and the raw `node --test` suite do not change that, and they cannot substitute for a release gate that fails closed when any proof remains `labBacked: true` or `productionThroughput: 'not-claimed'`.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or any storage abstraction that can satisfy the tests without touching live source storage or a real apply-time mutation. The current helpers and smokes do not satisfy this because the production-shaped routes still label themselves `labBacked: true`.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one. Refusal-only benchmarks are not a speed claim, and release language must not drift into implied speed confidence without live-path measurement.
8. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
9. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix. This checkout has no `.github/` workflow directory, and nothing in `package.json` compensates for that gap. `npm run test:playground` is an optional lab chain, not an enforced release path.

## Evidence Table

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `node --test` proves refusal behavior, recovery classification, local integrity checks, and the benchmark stance that `productionThroughput` stays `not-claimed`. | Nothing in the current executable set reaches the one-way pull base plus one-way push to live source boundary, rechecks live state at apply time, or emits a release verdict. | The suite can still pass while the live-source claim remains unproven, so it is not release evidence. |
| Lab / fixture proof | Playground and authenticated smokes exercise route shape, auth/session scaffolding, journaling, stale-claim rejection, and lab-only push paths. The strongest production-shaped route and package smokes still report `labBacked: true`. | They remain `labBacked: true`, fixture-backed, or model-backed, so they still do not touch the live-source boundary. | Lab evidence cannot prove production no-loss, reliability, or speed, and it must be treated as non-release proof. |
| Docs-only proof | The audit and blocker notes describe the intended one-way pull base plus one-way push flow. | Documentation cannot recheck live state or mutate production storage. | Prose can explain the gate, but it cannot satisfy the gate. |
| Missing proof | Live-source mutation, crash survival on production storage, required auth/session plus journal plus leases/fencing plus graph identity plus plugin-data-driver gate, a real remote/local topology, and a measured live-path speed verdict or enforced `speed unclaimed` refusal. | These are still absent from the mandatory command surface and from [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json)'s scripts. There is also no checked-in `.github/` workflow file in this checkout. | The repo has no enforced release verdict, so green local evidence can still bypass release and leave data-loss, reliability, and speed claims open. |

Treat indirect evidence as insufficient:

- Fixture coverage can show the code is shaped correctly.
- Lab coverage can show the local flow is plausible.
- Refusal benchmarks can show unsupported claims are blocked.
- None of those prove the live source was safely mutated, recovered, and measured in one required release run.

## Test Audit

The strongest current tests are guardrails, not release proof. They are worth keeping, but they do not close the objective on their own, and they are not a substitute for a required live-source release command.

| Test surface | What it really proves | What it does not prove |
| --- | --- | --- |
| [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) | Directional planning rules, stale-claim rejection, plugin-owner checks, and recovery classification in controlled fixtures | Live-source mutation, production no-loss behavior, real remote/local topology, or crash survival on production storage | Fixture proof can reject bad plans, but it cannot certify the live write path. |
| [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | File-backed journal sequencing, redaction, and restart inspection in local temp storage | Durable production storage, fencing against concurrent workers, or live-boundary replay after a crash | Local file behavior is not the same as production durability. |
| [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) | Internal benchmark guardrails and rejection of unsupported speed claims | Measured live-path throughput or any release-grade speed threshold | A refusal-only model does not prove speed. |
| [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | Integrity checks and the current `productionThroughput: 'not-claimed'` stance, plus explicit refusal to upgrade that into a production throughput claim | Any positive speed claim, a measured threshold, or a required release verdict | The benchmark currently blocks overclaiming, but it does not supply the missing release verdict. |
| `npm run test:playground:*` helpers | Auth/session scaffolding, route shape, journal sequencing, stale-claim rejection, and production-shaped plugin packaging in sandboxed Playground instances | Real live-source mutation, production storage durability, or real remote/local topology | A Playground helper can be convincing and still fail to prove the release path. |

The sharpest test verdict is negative: the current tests are good at proving what the repo must refuse, but they do not prove the live-source path succeeds under the release boundary. That means the suite is suitable as guardrail evidence and regression evidence only until a mandatory release command exists. If someone cites `node --test` alone as a production release argument, that would overstate the evidence, because the suite does not prove no data loss, reliable crash recovery, or measured speed on the live path.

## Release Summary

| Item | Current reading |
| --- | --- |
| Strongest executable proof | `node --test` plus the fixture and model suites can prove refusal behavior, classification, and local integrity checks. None of them reach the live-source boundary, and none of them can emit a mandatory release verdict. |
| Strongest lab proof | Playground and authenticated smokes can exercise route shape, auth/session scaffolding, journaling, and stale-claim rejection, but they still self-identify as `labBacked: true`. |
| Strongest docs-only proof | The audit and blocker notes correctly describe the intended one-way pull base plus one-way push flow. |
| Missing release proof | Live-source mutation, crash survival on production storage, required auth/session plus journal plus lease/fencing plus graph identity plus plugin-data-driver gate, and a measured live-path speed verdict or enforced `speed unclaimed` refusal emitted by a mandatory release command. |
| Release blocker | There is no mandatory `verify`, `verify:release`, or `release` command that can fail closed when any of those proofs are absent. |

Current reading: the repo can already refuse unsafe states, but it cannot yet issue a production release verdict. The blocker is structural: no required command owns the live-source verdict.

## Actionable Gate

The repo needs one checked-in command that is impossible to confuse with optional smokes:

1. run the existing guardrail suites
2. reach the live-source boundary in the same invocation
3. recheck apply-time state before mutation
4. fail closed if auth/session, journal, lease/fencing, graph identity, plugin-data-driver, or topology proof is still lab-backed
5. emit a machine-checkable verdict for throughput, either a measured threshold or `speed unclaimed`

Without that command, every passing test remains support evidence only.

## Weakest Current Claim

The weakest claim is the production release verdict itself.

- No required command exists that must reach the live-source boundary and emit a machine-checkable release decision.
- The suite can still go green without proving live-source mutation, crash survival, replay safety, or throughput on the real path.
- `speed unclaimed` is the only honest speed posture right now, but it only matters if a required gate prints it and fails closed when live-path measurement is missing.
- Any release wording that implies no data loss, reliability, or speed from the current suite alone is overstated.
- The current test suite can reject unsafe states, but it cannot prove the objective's positive claim unless a mandatory live-source verdict is added.
- Because that verdict is still missing from the command surface, the current evidence can only support a regression or lab narrative. It cannot close release.

Actionably: the next release gate must be a checked-in command that (1) revalidates live remote state at apply time, (2) requires auth/session plus durable journal plus leases/fencing plus graph identity plus plugin-driver proof, (3) touches the live-source boundary in the same run, and (4) fails closed unless it can emit a machine-checkable release verdict. Until that exists, the strongest defensible statement is not "safe enough to release" but "safe enough to refuse unsafe claims."

## Proof Boundary

Current proof must be judged against the live-source release boundary, not against the existence of local helper paths. The following are useful inputs, but they are not release proof on their own:

- planner refusal tests that only compare fixtures and local hashes
- journal tests that only read and write local files
- benchmark tests that only model a speed claim or refuse an unsupported one
- route smokes that still report `labBacked: true`
- any proof that does not exercise the one-way pull base to one-way push to live source loop on the real release boundary

The strongest current runnable evidence still falls into four classes:

- executable proof: none that reaches the live-source boundary; the strongest tests are [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js), but every one of them remains fixture-, model-, or refusal-backed rather than live-source-backed
- lab / fixture proof: `npm test` plus the optional file-backed and Playground smokes
- docs-only proof: prose in `README.md`, `progress.html`, `audits/release-blockers.md`, and the supervisor/audit notes
- missing proof: live-source apply-time mutation, durable crash survival on production storage, measured live-path throughput, an enforced `speed unclaimed` verdict when measurement is absent, and a required release gate that can fail closed when those proofs are absent

The uncomfortable conclusion is that the current tests are good enough to block overclaiming, but not good enough to support the release statements the objective asks for. They prove the suite knows how to refuse unsafe claims. They do not prove the live push path is lossless, reliable, or fast enough.

## Requirement Map

Proof buckets used below:

- `Executable proof` means a required command or test reaches the live-source boundary and can fail the release.
- `Lab / fixture proof` means the evidence is real code execution, but it is still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof` means prose, labels, or audit statements with no executable boundary.
- `Missing proof` means the repo has no current evidence for the requirement at the release boundary.
- `Release blocker` states why the requirement still prevents a production claim.

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| One-way pull base plus one-way push to live source | Directional planning and push-shape docs | A real live-source apply in the same run | Direction alone is not a release verdict |
| Apply-time recheck | Stale-claim refusal and local preflight checks | Recheck against the live source immediately before mutation | A stale preflight can still pass locally |
| No data loss | Local journal sequencing and replay classification | Live-boundary no-loss proof on production storage | Fixture replay is not production durability |
| Reliability | Auth/session scaffolding, replay rejection, and journal guardrails | One mandatory gate that composes auth/session, journal, leases/fencing, graph identity, and plugin-driver checks | Distributed helper proofs do not close the release decision |
| Speed | `productionThroughput: 'not-claimed'` and refusal-only benchmark behavior, which is a refusal to overclaim rather than a measured live-path result | A measured live-path threshold or an enforced `speed unclaimed` verdict from a required release command | Refusal is not performance evidence |
| Mandatory release gate | Optional smokes and `npm test` | A checked-in `verify`, `verify:release`, or `release` command, plus a checked-in workflow or other default entrypoint that invokes it | Optional runs can bypass the live-source verdict |

Only the first bucket would count as release proof, and it does not exist in this checkout. The current repository only has lab / fixture proof and docs-only proof, so it still falls short of the live-source release boundary. In other words, the suite can reject unsafe states, but it cannot certify a live push, no data loss, or reliable speed on the production path. A passing lab suite here is still compatible with a release that would lose writes, fail under a crash, or have no measured throughput at all.
