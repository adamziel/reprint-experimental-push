# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The blocker is structural: there is still no mandatory command that proves the one-way pull base plus one-way push back to the live source on the real storage and transport path. `node --test` passes, but the passing subtests are still fixture-, model-, refusal-, or lab-backed, and `package.json` exposes only `test`, `plan`, `apply`, and optional `test:playground:*` helpers. There is no checked-in `verify`, `verify:release`, or `release` command, and there is no `.github/workflows/` entrypoint in this checkout to compensate. The strongest production-shaped smokes still self-identify as `labBacked: true`, so they remain lab proof rather than live-source proof. The benchmark surface is also explicit: it reports `productionThroughput: 'not-claimed'`, and the guarded benchmark tests refuse to upgrade that into a claim. That is refusal evidence, not release proof. Until a required gate reaches the live-source boundary, rechecks apply-time state, and emits a machine-checkable verdict, `speed unclaimed` is the only defensible production-facing wording. No current green run can legitimately be read as proof that writes are lossless, that the live push path is reliable under crash/retry/replay, or that production speed has been measured. The existing [`audits/release-proof-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/release-proof-matrix.md) repeats that same gap in tabular form; it is supporting audit evidence, not a release gate. The evidence deficit is categorical, not incremental: nothing currently on the command surface owns the live-source verdict, and the local recovery tests remain local-file or fixture-backed rather than proving crash survival on the live boundary.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not bidirectional.
2. Recheck the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve every WordPress data shape the push can touch, including rows, files, plugin-owned data, serialized payloads, and graph identity, at the live-source boundary.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary.
5. Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes. The current `package.json` exposes many `test:playground:*` helpers, plus `plan` and `apply`, but it still does not define a required `verify`, `verify:release`, or `release` command, so there is no mandatory gate that composes those checks into one verdict. Optional scripts such as `test:playground:*` and the raw `node --test` suite do not change that, and they cannot substitute for a release gate that fails closed when any proof remains `labBacked: true`, fixture-only, or `productionThroughput: 'not-claimed'`. If a candidate gate does not touch the live-source boundary in the same invocation, it is still not release proof.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or any storage abstraction that can satisfy the tests without touching live source storage or a real apply-time mutation. The current helpers and smokes do not satisfy this because the production-shaped routes still label themselves `labBacked: true`.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one. Refusal-only benchmarks are not a speed claim, and release language must not drift into implied speed confidence without live-path measurement.
8. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
9. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix. This checkout has no `.github/` workflow directory, and nothing in `package.json` compensates for that gap. `npm run test:playground` is an optional lab chain, not an enforced release path.

## Release Gate Definition

The weakest current claim is not merely that the suite is incomplete. It is that the repository still lacks one enforced command that would be required to make any production claim credible, and therefore no green run can be promoted to release proof by interpretation alone.

Right now the best available commands are `node --test`, `npm run test:playground`, `plan`, and `apply`. Those are useful, but they are support paths, not a release gate, because none of them force a live-source verdict in the same invocation.

Minimum properties of that gate:

1. it must run on the real release boundary, not just on fixtures or Playground storage
2. it must revalidate apply-time live state before mutation
3. it must fail closed if auth/session, journal, leases/fencing, graph identity, plugin-driver, or topology proof is still lab-backed
4. it must print a machine-checkable verdict for speed, including an explicit `speed unclaimed` refusal when no live-path measurement exists
5. it must be the command CI or another default entrypoint actually invokes

Minimum acceptable command shape:

- `verify` or `verify:release` is the clearest choice for an enforced gate.
- `release` is acceptable only if it is the actual default gate and cannot be bypassed by optional helper scripts.
- Anything that only shells out to `test:playground:*` or `node --test` remains support evidence, not release proof.

## Claim Status

| Claim | Current status | Why it is still blocked |
| --- | --- | --- |
| No data loss | Unproven | The current passing suite proves local ordering, replay classification, and journal guardrails, but it does not prove live-source mutation on production storage preserves every touched WordPress data shape end to end. |
| Reliability | Unproven | Auth/session, journal, lease/fencing, graph identity, and plugin-driver checks exist only as distributed helpers and smokes, not as one mandatory live-source release gate. |
| Speed | Unproven | `productionThroughput` remains `not-claimed`, and the benchmark surface is refusal-only. There is still no required live-path measurement or enforced `speed unclaimed` release verdict. |
| Release readiness | Blocked | There is no checked-in command that reaches the live-source boundary, rechecks apply-time state, and fails closed on missing proof. |

## Evidence Table

Evidence buckets used below:

- `Executable proof` means a required command reaches the live-source boundary and can fail the release.
- `Lab / fixture proof` means the evidence is real code execution, but it is still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof` means prose, labels, or audit statements with no executable boundary.
- `Missing proof` means the repo has no current evidence for the requirement at the release boundary.
- `Release blocker` states why the requirement still prevents a production claim.

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `node --test` proves planner refusals, replay classification, journal integrity checks, local mutation ordering, and the benchmark stance that `productionThroughput` stays `not-claimed`. | Nothing in the current executable set reaches the one-way pull base plus one-way push to live source boundary, rechecks live state at apply time, or emits a release verdict. The green tests do not prove no data loss across posts, postmeta, uploads, taxonomies, menus, users, plugin-owned rows, serialized payloads, or graph identity on the real source boundary. | These tests are valid regression evidence, but they are not positive proof of a safe live push. |
| Lab / fixture proof | Playground and authenticated smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:db-journal-stale-claim-all-old`, and `test:playground:recovery` exercise route shape, auth/session scaffolding, journaling, stale-claim rejection, and lab-only push paths. The strongest production-shaped route and package smokes still report `labBacked: true`. | They remain `labBacked: true`, fixture-backed, or model-backed, so they still do not touch the live-source boundary. | Lab evidence can justify development confidence, not production release. |
| Refusal / model proof | The benchmark and planner suites explicitly reject unsupported speed claims, unsafe plans, stale claims, and malformed recovery states. `test/performance-model.test.js` proves the model keeps `productionThroughput` unclaimed, and `test/guarded-executor-benchmark.test.js` proves the benchmark refuses to upgrade that into a release claim. | They do not measure the live path, prove durability on production storage, or show crash survival on a real source. | Refusal is necessary, but refusal alone cannot certify the objective's positive claims. |
| Docs-only proof | The audit and blocker notes describe the intended one-way pull base plus one-way push flow and the missing gate shape. | Documentation cannot recheck live state or mutate production storage. | Prose can explain the gate, but it cannot satisfy the gate. |
| Missing proof | Live-source mutation, crash survival on production storage, required auth/session plus journal plus leases/fencing plus graph identity plus plugin-data-driver gate, a real remote/local topology, and a measured live-path speed verdict or enforced `speed unclaimed` refusal. | These are still absent from the mandatory command surface and from [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json). `package.json` stops at `test`, `plan`, `apply`, and optional `test:playground:*` helpers, and there is no checked-in workflow entrypoint in this checkout. The strongest lab routes and smokes still mark themselves `labBacked: true`, so they remain non-release evidence even when green. No current test proves the live push preserves all touched WordPress data shapes end to end; the absence is still on the release boundary, not in the helper scripts. | The repo has no enforced release verdict, so green local evidence can still bypass release and leave data-loss, reliability, and speed claims open. `speed unclaimed` remains the only honest speed posture until a required gate proves the live path. |

Treat indirect evidence as insufficient:

- Fixture coverage can show the code is shaped correctly.
- Lab coverage can show the local flow is plausible.
- Refusal benchmarks can show unsupported claims are blocked.
- None of those prove the live source was safely mutated, recovered, and measured in one required release run.
- If the only green evidence is fixture-, lab-, or refusal-backed, the release blocker is still active.

Current blocker summary:

- There is no enforced live-source release gate.
- The strongest push and recovery evidence is still `labBacked: true` or fixture-backed.
- No current test proves no data loss, reliability under crash/replay, or measured live-path speed on the real source boundary.
- `speed unclaimed` remains the only defensible speed statement until the live path is measured by a required command.

## Test Audit

The strongest current tests are guardrails, not release proof. They are worth keeping, but they do not close the objective on their own, and they are not a substitute for a required live-source release command. A green `npm test` run makes the evidence sharper rather than safer: the suite is green, yet still stops short of the live-source release boundary. Their main value is negative proof: they show the repo can refuse bad states, not that it can complete the live push safely.

| Test surface | What it really proves | What it does not prove |
| --- | --- | --- |
| [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) | Local planning logic, live-remote precondition tracking, conflict detection, and refusal to apply stale or overlapping changes. | It does not mutate the live source boundary, prove no data loss on production storage, or exercise a real remote/local topology. |
| [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | File-backed journal sequencing, redaction, restart classification, and recovery state inspection. | It does not prove durable production storage, crash survival on live state, or journal behavior across the real release boundary. |
| [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) | Guardrail structure for benchmark modeling, refusal of unsupported throughput claims, and internal safety contracts. | It does not measure live-path throughput or establish a release-grade speed claim. |
| [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | Tamper detection and explicit refusal of unsupported benchmark claims. | It does not prove that the live push path is fast, nor does it clear a release threshold. |

None of those tests is weak because it fails to assert enough detail. They are weak only in the specific sense that they stop at the wrong boundary. A release claim needs a required command that binds those guardrails to a live-source apply step; without that, the suite can still be green while the objective remains unproven.

Concrete read:

- `test/push-planner.test.js` tells us the planner refuses stale or overlapping changes, but it does not prove the source site was mutated safely.
- `test/recovery-journal.test.js` tells us the journal is consistent on local files, but it does not prove crash survival on the real storage path.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` tell us the benchmark surface refuses unsupported throughput claims, but they still leave `productionThroughput: 'not-claimed'` as a refusal, not a measurement.
- `npm test` is therefore a valid regression check and not a release gate.
- The absence of a required live-source command means the suite cannot prove no data loss, reliability under crash/replay, or speed on the real push path.

## Release Summary

| Item | Current reading |
| --- | --- |
| Strongest executable proof | `node --test` plus the fixture and model suites can prove refusal behavior, classification, and local integrity checks. None of them reach the live-source boundary, and none of them can emit a mandatory release verdict. They do not prove no data loss, reliable crash recovery, or measured live-path speed. |
| Strongest lab proof | Playground and authenticated smokes can exercise route shape, auth/session scaffolding, journaling, and stale-claim rejection, but they still self-identify as `labBacked: true`, so they are explicitly not release proof. |
| Strongest docs-only proof | The audit and blocker notes correctly describe the intended one-way pull base plus one-way push flow. |
| Missing release proof | Live-source mutation, crash survival on production storage, required auth/session plus journal plus lease/fencing plus graph identity plus plugin-data-driver gate, and a measured live-path speed verdict or enforced `speed unclaimed` refusal emitted by a mandatory release command. |
| Release blocker | There is no mandatory `verify`, `verify:release`, or `release` command that can fail closed when any of those proofs are absent, and no checked-in workflow entrypoint closes that gap. |

Current reading: the repo can already refuse unsafe states, but it cannot yet issue a production release verdict. The blocker is structural: no required command owns the live-source verdict, so every green result still depends on optional evidence rather than a mandatory release gate. If the release decision is not forced through the live-source path, the repository still cannot claim no data loss, reliability, or speed.

Actionable release criterion:

- add one checked-in command that revalidates live state, applies to the real source boundary, and prints a fail-closed verdict
- wire that command into CI or another default invocation path
- keep `speed unclaimed` as the required output until a live-path measurement is available

## Actionable Gate

The repo needs one checked-in command that is impossible to confuse with optional smokes:

1. run the existing guardrail suites
2. reach the live-source boundary in the same invocation
3. recheck apply-time state before mutation
4. fail closed if auth/session, journal, lease/fencing, graph identity, plugin-data-driver, or topology proof is still lab-backed
5. emit a machine-checkable verdict for throughput, either a measured threshold or `speed unclaimed`
6. make the release decision depend on the live-source result, not on fixture or Playground success alone

Without that command, every passing test remains support evidence only.

## Weakest Current Claim

The weakest claim is any implication that the current suite can certify the live-source release boundary. That claim is unsupported for one simple reason: there is still no required command that must touch live source storage and then emit a release verdict in the same run.

- No required command exists that must reach the live-source boundary and emit a machine-checkable release decision.
- The suite can still go green without proving live-source mutation, crash survival, replay safety, or throughput on the real path.
- `speed unclaimed` is the only honest speed posture right now, but it only matters if a required gate prints it and fails closed when live-path measurement is missing.
- Any release wording that implies no data loss, reliability, or speed from the current suite alone is overstated.
- A green `node --test` run and green Playground smokes still do not prove no data loss, reliable crash recovery, or measured speed on the live-source path.
- The current test suite can reject unsafe states, but it cannot prove the objective's positive claim unless a mandatory live-source verdict is added and wired into the default release path.
- Because that verdict is still missing from the command surface, the current evidence can only support a regression or lab narrative. It cannot close release.
- The weakest current claim is therefore any sentence that reads as if the existing green tests already certify release readiness, or that optional smokes are equivalent to a required release gate.
- Said differently: the strongest present tests prove that the repository knows how to refuse unsafe claims, not that it can make the objective's positive claims on a live source.

Actionably: the next release gate must be a checked-in command that (1) revalidates live remote state at apply time, (2) requires auth/session plus durable journal plus leases/fencing plus graph identity plus plugin-driver proof, (3) touches the live-source boundary in the same run, and (4) fails closed unless it can emit a machine-checkable release verdict. Until that exists, the strongest defensible statement is not "safe enough to release" but "safe enough to refuse unsafe claims." Any future claim of no data loss, reliability, or speed must point at that gate, not at `node --test` or the lab smokes, because those runs can still succeed without proving the live-source boundary.

## Proof Boundary

Current proof must be judged against the live-source release boundary, not against the existence of local helper paths. The following are useful inputs, but they are not release proof on their own:

- planner refusal tests that only compare fixtures and local hashes
- journal tests that only read and write local files
- benchmark tests that only model a speed claim or refuse an unsupported one
- route smokes that still report `labBacked: true`
- any proof that does not exercise the one-way pull base to one-way push to live source loop on the real release boundary

The strongest current runnable evidence still falls into four classes:

- executable proof: none that reaches the live-source boundary; the strongest tests are [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js), but every one of them remains fixture-, model-, or refusal-backed rather than live-source-backed
- lab / fixture proof: `npm test` plus the optional file-backed and Playground smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:db-journal-stale-claim-all-old`, and `test:playground:recovery`
- docs-only proof: prose in `README.md`, `progress.html`, `audits/release-blockers.md`, and the supervisor/audit notes
- missing proof: live-source apply-time mutation, durable crash survival on production storage, measured live-path throughput, an enforced `speed unclaimed` verdict when measurement is absent, and a required release gate that can fail closed when those proofs are absent

The uncomfortable conclusion is that the current tests are good enough to block overclaiming, but not good enough to support the release statements the objective asks for. They prove the suite knows how to refuse unsafe claims. They do not prove the live push path is lossless, reliable, or fast enough on the real source boundary.

## Test Audit Snapshot

| Test surface | Current proof | Unproven release claim |
| --- | --- | --- |
| `test/push-planner.test.js` | Directionality, precondition checking, and stale-plan refusal in fixture scope | A live-source push boundary, no-data-loss release proof, and remote/local topology proof |
| `test/recovery-journal.test.js` | Local journal sequencing, redaction, restart classification, and recovery inspection | Durable production storage, crash survival on live state, and live-boundary replay safety |
| `test/performance-model.test.js` | Benchmark guardrails and refusal of unsupported throughput claims | Measured live-path throughput and any positive speed claim |
| `test/guarded-executor-benchmark.test.js` | Tamper detection and refusal to upgrade unsupported benchmark claims | A release-grade performance verdict on the real push path |
| `npm test` as a whole | The repository can reject unsafe claims in lab or fixture scope | A mandatory live-source verdict that can certify no data loss, reliability, or speed |

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

The current test mix is therefore best read as negative evidence:

- it proves the planner refuses stale or conflicting states in local snapshots
- it proves the journal code can serialize, redact, and restart local recovery records
- it proves the benchmark model refuses unsupported throughput claims
- it does not prove that the one-way pull base plus one-way push to live source path can safely mutate live storage
- it does not prove that production durability, retry safety, or performance have been measured on the real boundary

The practical audit conclusion is therefore narrower than "the tests are incomplete": the repo lacks a mandatory live-source release gate, so the existing tests cannot be upgraded into release proof by interpretation alone. Until one checked-in command owns the live-source mutation and the speed verdict in the same run, every passing test remains support evidence only.
