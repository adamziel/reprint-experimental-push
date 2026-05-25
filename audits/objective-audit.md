# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

Fresh recheck on 2026-05-25: `package.json` still has no `verify`, `verify:release`, or `release` script, and this checkout still has no `.github` tree or workflow entrypoint. That means the repo still lacks a mandatory command that can fail closed at the live-source boundary, export `REPRINT_PUSH_SOURCE_URL`, and record preserved-remote evidence in the same required invocation. The missing artifact is concrete: there is still no checked-in command surface that can own a live-source preflight verdict.
Fresh recheck on 2026-05-25: there is still no checked-in command that supplies a retained local, Playground, or Docker source endpoint by default and then proves preserved-remote behavior from that same endpoint. The current helper surface can be run, but it does not yet supply the live-source input and verdict together, so the repository still lacks a true release gate rather than just a wrapper around one.
Fresh recheck on 2026-05-25: `package.json` still exposes only helper and lab commands, including `test:playground:production-shaped-push`, but no checked-in command that both supplies a retained source endpoint by default and proves preserved-remote behavior in the same run. That means any release-shaped wrapper remains insufficient on its own.
Fresh recheck on 2026-05-25: `node --test` still passes at `89/89`, but that result remains regression evidence only because there is still no checked-in live-source release gate.
Fresh repo-wide recheck on 2026-05-25: there is still no command or workflow surface in this checkout that upgrades the existing regression, fixture, or lab smokes into a required live-source preflight. The missing artifact is still the same one: a checked-in command that reaches the live-source boundary, exports `REPRINT_PUSH_SOURCE_URL`, and fails closed when preserved-remote evidence is absent.
Current audit focus recheck: there is still no checked-in invocation that proves preserved-remote evidence against a retained local, Playground, or Docker source endpoint in the same run. The command-surface absence is the blocker, not the test count: until a checked-in `verify:release` or equivalent gate exists, this remains the top release blocker.
Fresh recheck on 2026-05-25: the strongest helper scripts still stop at `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` flows; they do not compose auth/session, durable journal, leases/fencing, graph identity, plugin drivers, and preserved-remote evidence into one required release verdict. That means the suite remains useful refusal evidence, but it still does not prove no data loss, reliability, or speed on the live source.

The blocker is structural: there is still no mandatory command that proves the one-way pull base plus one-way push back to the live source on the real storage and transport path. `node --test` passes, but the passing subtests are still fixture-, model-, refusal-, or lab-backed, and `npm test` is green at `89/89` without changing that boundary. `package.json` still exposes `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers, but no `verify`, `verify:release`, or `release` command. The top release blocker remains the missing real-site push preflight command: there is no checked-in invocation that reaches the live-source boundary and fails closed before release when live proof is absent, and there is no checked-in harness that supplies `REPRINT_PUSH_SOURCE_URL`, runs against a retained local, Playground, or Docker source endpoint, and records preserved-remote evidence from the same required command. The strongest production-shaped smokes still self-identify as `labBacked: true`, so they remain lab proof rather than live-source proof. The benchmark surface is also explicit: it reports `productionThroughput: 'not-claimed'`, and the guarded benchmark tests refuse to upgrade that into a claim. That is refusal evidence, not release proof. Until a required gate reaches the live-source boundary, rechecks apply-time state, and emits a machine-checkable verdict, `speed unclaimed` is the only defensible production-facing wording. No current green run can legitimately be read as proof that writes are lossless, that the live push path is reliable under crash/retry/replay, or that production speed has been measured. The existing [`audits/release-proof-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/release-proof-matrix.md) repeats that same gap in tabular form; it is supporting audit evidence, not a release gate. The evidence deficit is categorical, not incremental: nothing currently on the command surface owns the live-source verdict, and every helper path still stops short of proving crash survival or lossless mutation on the live boundary. A live-source harness that exports `REPRINT_PUSH_SOURCE_URL` and preserves remote evidence is still missing, so fixture-only work remains non-release evidence.

The uncomfortable reading is that this is not a missing assertion problem. The repo already has assertions, refusals, and green regression runs. What it lacks is a mandatory release command that binds those checks to a live-source apply step and can fail closed when the live verdict is still absent.

That is why the audit stays strict: the current suite can reject unsafe states, but it still cannot certify no data loss, reliability, or speed on the live source.

That means the current green suite is useful only as regression evidence. It is not enough to justify a production claim, and it should not be read as proof that no data loss, reliability, or speed has been demonstrated on the live source boundary.

Boundary note: `npm test` is only a green regression signal unless the same invocation also reaches the live-source apply boundary and fails closed on missing release proof. Without that, the pass rate cannot be promoted to a durability, reliability, or throughput claim.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not bidirectional.
2. Recheck the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve every WordPress data shape the push can touch, including rows, files, plugin-owned data, serialized payloads, and graph identity, at the live-source boundary.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary.
5. Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or any storage abstraction that can satisfy the tests without touching live source storage or a real apply-time mutation.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one.
8. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
9. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix.

Top release blocker:

- there is still no checked-in real-site push preflight command that owns the release verdict
- there is still no checked-in live-source harness or `verify:release` command that sets `REPRINT_PUSH_SOURCE_URL`, runs against a retained local, Playground, or Docker source endpoint, and records preserved-remote evidence in the same invocation
- there is still no checked-in workflow entrypoint in this checkout that could enforce that required command
- until that command exists, fixture-only and lab-backed work can keep passing without proving the live-source boundary

Requirement mapping rule:

- if a requirement is only proven in fixtures, Playground, or model code, it is not release proof
- if a requirement is only described in prose, it is not release proof
- if a requirement does not touch the live-source boundary in the same required invocation, it is not release proof
- only executable proof at the live-source boundary can move a requirement out of the missing-proof or blocker bucket

Release translation:

- prose about a gate is not the gate
- fixture, Playground, and model success are not live-source proof
- if a required run does not touch the live-source boundary in the same invocation, it is still support evidence only

Current command-surface gap:

- Current checked-in scripts are `test`, `plan`, `apply`, `test:recovery:file-journal`, `test:playground`, and the `test:playground:*` helpers for plan/apply/push-protocol, HTTP push, authenticated push, production-shaped push, plugin package, atomic install, journal idempotency, storage-guarded writes, drift, kill, missing commit finalization, stale-claim replay, and recovery.
- None of those scripts is a required `verify`, `verify:release`, or `release` command, so there is still no checked-in real-site push preflight or release gate on the command surface.
- None of those scripts supplies a retained source endpoint by default and then proves preserved-remote evidence from that same endpoint, so they remain wrappers around release-shaped checks rather than a release gate.
- Optional scripts such as `test:recovery:file-journal`, `test:playground:*`, and the raw `node --test` suite do not substitute for a release gate.
- If a candidate gate does not touch the live-source boundary in the same invocation, it is still not release proof, even if it also exercises auth, journal, or recovery logic.
- The current production-shaped routes still label themselves `labBacked: true`, so the real remote/local topology is still unproven.
- The practical meaning is simple: `npm test` can stay green while the repository still has no mandatory command that can certify no data loss, reliability, or speed on the live source.
- A direct filesystem check still finds no `.github` tree in this checkout, so there is also no checked-in workflow entrypoint that could enforce a missing release gate from the repository side.
- The missing command is concrete: there is no checked-in `verify:release` or `release` entrypoint that runs a live-source preflight and fails closed on missing live proof.

Release preflight absence:

- there is still no checked-in command that reaches the live-source boundary and fails closed when live proof is absent
- there is still no checked-in live-source harness or `verify:release` command that can set `REPRINT_PUSH_SOURCE_URL`, exercise a retained local/Playground/Docker source, and write preserved-remote evidence in the same run
- there is still no checked-in real-site push preflight command on the required path, only helper scripts and lab smokes
- there is still no checked-in release command that can serve as the real-site push preflight and fail closed on missing live proof
- there is still no checked-in workflow entrypoint or `.github` tree in this checkout to enforce that verdict
- until that changes, the top release blocker remains the missing real-site push preflight command
- fixture-only or lab-backed work is still insufficient for shipping, even when it is green
- a real-site preflight command must exist on the checked-in command surface before the release verdict can move

Release command audit:

- direct command-surface recheck on 2026-05-25: [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still has no `verify`, `verify:release`, or `release` script, so there is still no checked-in release gate to own the live-source verdict
- direct command-surface recheck on 2026-05-25: `package.json` still has no `test:playground:production-shaped-release-proof` or equivalent checked-in gate, so there is still no helper that both supplies a source endpoint and proves preserved-remote behavior in one required invocation
- `package.json` has no `verify`, `verify:release`, or `release` script
- `npm test` only executes `node --test`; it does not force a live-source apply boundary
- `test:playground:*` helpers are optional and lab-scoped
- `test:recovery:file-journal` proves file-backed restart behavior only
- there is no checked-in workflow or `.github` tree in this checkout that can upgrade regression evidence into a release gate
- there is no checked-in `verify` wrapper that a human or CI can invoke as the required live-source preflight
- the current green suite is regression evidence, not proof of no data loss, reliability, or measured speed on the live push path
- the weakest current claim is not "the tests are incomplete" but "the real-site push preflight command already exists"; that claim is false in this checkout
- the actionable gap is the missing enforced command, not more fixture-only coverage

## Release Gate Definition

The weakest current claim is not merely that the suite is incomplete. It is that the repository still lacks one enforced command that would be required to make any production claim credible, and therefore no green run can be promoted to release proof by interpretation alone. The actionable fix is not another lab helper; it is a checked-in `verify`, `verify:release`, or `release` gate, wired into the default automation path, that fails closed unless it can prove live-source state at apply time, reject stale claims, and emit a machine-checkable verdict from the same invocation. Until that exists, the strongest evidence remains regression or lab evidence, not release evidence.

Right now the best available commands are `node --test`, `npm run test:playground`, `plan`, and `apply`. Those are useful, but they are support paths, not a release gate, because none of them force a live-source verdict in the same invocation.

Fresh recheck on 2026-05-25: `node --test` still passes at `89/89`, but that does not change the absence of a checked-in live-source release gate.

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

## Test Audit Verdict

The test suite is doing the right kind of negative work, but it is still not positive release proof. More precisely: every current green path is either fixture-backed, lab-backed, model-backed, or refusal-backed, and none of them is a required live-source release gate.

- `test/push-planner.test.js` proves directionality, stale-plan refusal, and local mutation ordering in fixture scope. It does not prove lossless mutation on live WordPress storage.
- `test/recovery-journal.test.js` proves local journal integrity, restart classification, redaction, and restart-inspection behavior on temporary files. It does not prove crash durability on production storage or recovery across the live apply boundary.
- `test/performance-model.test.js` proves the benchmark model carries safety gates, still treats `productionThroughput` as unclaimed, and encodes safe-speedup refusal logic. It does not measure the live push path, so it cannot support a positive speed claim.
- `test/guarded-executor-benchmark.test.js` proves the guarded benchmark can move staged buffers and row payloads through durable evidence while refusing to promote unsupported throughput claims. It does not prove the live push path is fast or release-ready.
- `test/playground-snapshot-lib.test.js` and the Playground smokes prove that the fixture gates and lab routes can reject unsupported resources and exercise production-shaped paths. They still do not prove the live-source boundary, so they remain support evidence only.
- `npm test` being green at `89/89` on 2026-05-25 is therefore regression evidence, not release evidence.
- The strongest production-shaped smokes still report `labBacked: true`, so they remain lab proof even when they look operationally close to release.
- Any audit language that treats fixture, refusal, or lab-backed passes as proof of no data loss, reliability, or speed would be overstated.
- None of the current tests is a required release gate. They are useful proof fragments, but they do not compose into a live-source verdict in a single enforced command.

Claim summary:

| Claim | Current proof type | Missing proof | Release blocker |
| --- | --- | --- | --- |
| No data loss | Local fixture ordering, redaction, and replay classification in [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | Live-source end-to-end mutation on production storage across all touched WordPress data shapes | No mandatory live-source durability verdict |
| Reliability | Stale-plan refusal, auth/session scaffolding, journal guardrails, and lab smokes | One required gate that composes auth/session, durable journal, leases/fencing, graph identity, and plugin-driver checks at apply time | No single fail-closed release command |
| Speed | Refusal-only benchmark proof that keeps `productionThroughput` unclaimed in [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | A measured live-path throughput result or an enforced `speed unclaimed` verdict from the release gate | No mandatory throughput verdict |
| Release readiness | Regression and lab evidence only | A checked-in release command that reaches the live-source boundary and fails closed on missing proof | Optional helpers can still bypass the release boundary |

Test claim audit:

- `test/push-planner.test.js` proves planner refusal and live-remote precondition bookkeeping in fixture scope only
- `test/recovery-journal.test.js` proves file-backed monotonic journaling and restart classification only
- `test/performance-model.test.js` proves the benchmark model keeps production throughput unclaimed
- `test/guarded-executor-benchmark.test.js` proves the benchmark fails closed on tampering and still refuses production throughput claims
- `test/playground-snapshot-lib.test.js` proves the lab snapshot gate rejects unsupported resources, but it remains lab-only

## Claim Status

| Claim | Current status | Why it is still blocked |
| --- | --- | --- |
| No data loss | Unproven | The current passing suite proves local ordering, replay classification, and journal guardrails, but it does not prove live-source mutation on production storage preserves every touched WordPress data shape end to end. Local success is not end-to-end durability proof, and no live apply has been exercised in a mandatory gate. |
| Reliability | Unproven | Auth/session, journal, lease/fencing, graph identity, and plugin-driver checks exist only as distributed helpers and smokes, not as one mandatory live-source release gate. There is no single enforced command that can fail closed on the combined release boundary or recheck apply-time state before mutation. |
| Speed | Unproven | `productionThroughput` remains `not-claimed`, and the benchmark surface is refusal-only. There is still no required live-path measurement or enforced `speed unclaimed` release verdict from a mandatory release command. |
| Release readiness | Blocked | There is no checked-in command that reaches the live-source boundary, rechecks apply-time state, and fails closed on missing proof, so the green suite cannot be treated as release proof. |

## Evidence Table

Evidence buckets used below:

- `Executable proof` means a required command reaches the live-source boundary and can fail the release.
- `Lab / fixture proof` means the evidence is real code execution, but it is still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof` means prose, labels, or audit statements with no executable boundary.
- `Missing proof` means the repo has no current evidence for the requirement at the release boundary.
- `Release blocker` states why the requirement still prevents a production claim.

The distinction is operational: if a command does not export `REPRINT_PUSH_SOURCE_URL`, run against a retained local, Playground, or Docker source endpoint, and record preserved-remote evidence in the same invocation, it is not release proof.

Direct command-surface check on 2026-05-25: [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still has no `verify`, `verify:release`, or `release` script, so the repo still lacks a checked-in real-site push preflight command that could own the release verdict.
Direct filesystem check on 2026-05-25: this checkout has no `.github` tree or workflow entrypoint, so there is no checked-in automation path that can compensate for the missing release command.
Current recheck summary on 2026-05-25: the checked-in command surface still ends at `test`, `plan`, `apply`, `test:recovery:file-journal`, and `test:playground:*`, and the release automation tree is still absent.
Fresh run on 2026-05-25: `npm test -- --test-reporter=spec` passed `89/89`, but every passing case is still one of four kinds of evidence only: planner/refusal regression, lab/fixture gating, benchmark refusal, or file-journal recovery. None of the passing tests reaches a live-source endpoint or proves preserved-remote behavior in the same invocation, so the green test run does not move the release gate.
Current release-gate absence checklist:

- no checked-in command that both supplies a retained source endpoint and proves preserved-remote behavior in the same invocation
- no checked-in `verify` wrapper that exports `REPRINT_PUSH_SOURCE_URL`
- no checked-in `verify:release` command that runs against a retained local, Playground, or Docker source endpoint
- no checked-in command that records preserved-remote evidence in the same invocation
- no checked-in CI workflow or default entrypoint that can enforce the live-source verdict

The current [`audits/release-proof-matrix.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/release-proof-matrix.md) is aligned with this table. It is support material, not release proof.
The point of this table is separation, not synthesis: executable proof, lab / fixture proof, and docs-only proof all stay in their own buckets until one required command reaches the live-source boundary.

Release-command check:

- direct command-surface check on 2026-05-25: [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still has no `verify`, `verify:release`, or `release` script
- direct filesystem check on 2026-05-25: this checkout has no checked-in `.github/workflows/` entrypoint or `.github` tree that could enforce a live-source verdict
- direct repository check on 2026-05-25: there is no checked-in live-source harness or `verify:release` script that exports `REPRINT_PUSH_SOURCE_URL` and records preserved-remote evidence from a retained local, Playground, or Docker endpoint
- that absence is the top release blocker because it leaves fixture-only and lab-backed work able to stay green without proving the live boundary
- the missing artifact is a real-site push preflight command that fails closed on missing live-source proof
- any new fixture-only or lab-only work remains insufficient for shipping until a checked-in release command exists and fails closed on missing live-source proof
- new fixture-only work cannot close the blocker because the blocker is the missing live-source command, not the current regression suite

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `node --test` runs [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js), and [`test/playground-snapshot-lib.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/playground-snapshot-lib.test.js). `npm test` is green at `89/89`, so the regression suite is still passing. The direct command surface in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still stops at `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers, and this checkout has no `.github` tree to add an enforced workflow entrypoint. | The executable set still lacks a single required command that reaches the live-source boundary, rechecks live state at apply time, exports `REPRINT_PUSH_SOURCE_URL`, and records preserved-remote evidence from a retained local, Playground, or Docker source endpoint in the same invocation. | These tests are valid regression evidence, but they are not positive proof of a safe live push. |
| Executable proof | `npm test -- --test-reporter=spec` passed `89/89`. The passing set covers planner/refusal behavior, benchmark refusal, lab fixture gating, and file-backed recovery inspection, but it does not include a command that supplies a live source endpoint or proves preserved-remote behavior on the live boundary. | The executable set still lacks a single required command that reaches the live-source boundary, rechecks live state at apply time, exports `REPRINT_PUSH_SOURCE_URL`, and records preserved-remote evidence from a retained local, Playground, or Docker source endpoint in the same invocation. | These tests are valid regression evidence, but they are not positive proof of a safe live push. |
| Lab / fixture proof | Playground and authenticated smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:production-plugin-package`, `test:playground:plugin-atomic-install`, `test:playground:db-journal-idempotency`, `test:playground:storage-guarded-db-write`, `test:playground:storage-guarded-file-write`, `test:playground:mid-apply-drift`, `test:playground:db-journal-process-kill`, `test:playground:db-journal-missing-commit-finalization`, `test:playground:db-journal-stale-claim-all-old`, and `test:playground:recovery` exercise route shape, auth/session scaffolding, journaling, stale-claim rejection, storage guards, plugin packaging, and lab-only push paths. [`test/playground-snapshot-lib.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/playground-snapshot-lib.test.js) adds fixture-gate coverage by rejecting unsupported plugin, file, and row resources. The strongest production-shaped route and package smokes still report `labBacked: true`, and the production-shaped route smoke explicitly checks `routeProfile.labBacked === true` while exercising only a local Playground server started inside the test process. | They remain `labBacked: true`, fixture-backed, or model-backed, so they still do not touch the live-source boundary. | Lab evidence can justify development confidence, not production release. |
| Docs-only proof | The audit and blocker notes describe the intended one-way pull base plus one-way push flow, the missing release gate, and the need for `speed unclaimed` until live-path measurement exists. | Documentation cannot recheck live state or mutate production storage. | Prose can explain the gate, but it cannot satisfy the gate. |
| Missing proof | Live-source mutation, crash survival on production storage, real remote/local topology proof, required auth/session plus journal plus leases/fencing plus graph identity plus plugin-data-driver gate, a real-site push preflight command, and a measured live-path speed verdict or enforced `speed unclaimed` refusal. | These are still absent from the mandatory command surface and from [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json). That file currently stops at `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers, and this checkout has no `.github` tree or workflow entrypoint to force a release verdict. The strongest lab routes and smokes still mark themselves `labBacked: true`, so they remain non-release evidence even when green. [`test/playground-snapshot-lib.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/playground-snapshot-lib.test.js) also only proves the lab fixture gate rejects unsupported resources; it does not prove a live-source release boundary. No current test proves the live push preserves all touched WordPress data shapes end to end, and no mandatory command converts that missing proof into a fail-closed verdict. | The repo has no enforced release verdict, so green local evidence can still bypass release and leave data-loss, reliability, and speed claims open. `speed unclaimed` remains the only honest speed posture until a required gate proves the live path. |

The bucket split above is intentional:

- executable proof is still only regression, lab, or refusal execution until a live-source gate exists
- lab / fixture proof is useful for debugging, but it does not cross the release boundary
- docs-only proof explains the desired gate, but it cannot substitute for the gate
- missing proof is still the active blocker for no data loss, reliability, and speed claims
- the absence of a real-site push preflight command is the first blocker to clear before any other release claim can be promoted

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

Proof ledger:

| Bucket | Current state | Release meaning |
| --- | --- | --- |
| Executable proof | `node --test`, `npm test`, and the current helper suites all run, but they remain fixture-, model-, or lab-scoped. The repo still has no checked-in `verify`, `verify:release`, or `release` script in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and there is no workflow entrypoint in this checkout to compensate. | Useful regression evidence only; still no executable release gate |
| Lab / fixture proof | Playground smokes and route/package helpers still self-identify as `labBacked: true` | Support evidence, not release proof |
| Docs-only proof | The objective and blocker notes correctly describe the intended live-source release boundary | Explanatory only |
| Missing proof | Live-source apply-time mutation, durable production journal, lease/fence enforcement, graph identity proof, plugin-data-driver proof, and measured live-path speed | These are still required before release |
| Release blocker | No checked-in real-site push preflight command or workflow fails closed on the missing live-source proof set, and no checked-in default entrypoint closes the gap | Release remains blocked; fixture-only work cannot change that |

## Test Audit

The strongest current tests are guardrails, not release proof. They are worth keeping, but they do not close the objective on their own, and they are not a substitute for a required live-source release command. A green `npm test` run makes the evidence sharper rather than safer: the suite is green, yet still stops short of the live-source release boundary. Their main value is negative proof: they show the repo can refuse bad states, not that it can complete the live push safely. They do not prove no data loss, reliability under crash/replay, or measured speed on the live path.

The current passing set is narrower than a shippability gate would require:

- `test/push-planner.test.js` proves pull-base planning, stale-remote refusal, and conflict classification.
- `test/guarded-executor-benchmark.test.js` proves the benchmark refuses production throughput claims until the gaps are measured.
- `test/playground-snapshot-lib.test.js` proves the fixture gate rejects unsupported resources.
- `test/recovery-journal.test.js` proves file-backed restart inspection and recovery classification.

Those are all useful, but they still stay inside planner, benchmark, fixture, or local journal space. None of them proves a real-site push preflight against a retained source endpoint, and none of them proves no data loss on the live source.

The uncomfortable distinction is that the repository has runnable correctness evidence, but no runnable release-boundary evidence. That leaves the decisive question unanswered: can the one-way pull base plus one-way push back to the live source complete without data loss, with crash-safe recovery, and with a measured or explicitly refused speed claim in the same enforced command?

The audit rule here is strict:

- if a test only proves refusal, local ordering, or fixture integrity, it is not a release gate
- if a smoke is still `labBacked: true`, it is not live-source proof
- if the benchmark surface keeps `productionThroughput: 'not-claimed'`, it is not a speed claim
- if no required command composes the evidence in one run, the release boundary is still open

| Test surface | What it really proves | What it does not prove |
| --- | --- | --- |
| [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) | Local planning logic, live-remote precondition tracking, conflict detection, and refusal to apply stale or overlapping changes. | It does not mutate the live source boundary, prove no data loss on production storage, or exercise a real remote/local topology. |
| [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | File-backed journal sequencing, redaction, restart classification, and recovery state inspection. | It does not prove durable production storage, crash survival on live state, or journal behavior across the real release boundary. |
| [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) | Guardrail structure for benchmark modeling, refusal of unsupported throughput claims, and internal safety contracts. | It does not measure live-path throughput or establish a release-grade speed claim. |
| [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | Durable lab evidence for staged buffers, row payloads, graph-identity bookkeeping, and refusal to upgrade unsupported benchmark claims. | It does not prove that the live push path is fast, nor does it clear a release threshold. |

### Test Claim Matrix

| Claim | Current test proof | Release-grade proof missing |
| --- | --- | --- |
| No data loss | Local journal sequencing, replay classification, and planner refusal tests | Live-source apply-time mutation that preserves every touched WordPress data shape end to end |
| Reliability | Recovery classification, stale-claim refusal, and lab auth/session scaffolding | One mandatory live-source gate covering auth/session, durable journal, leases/fencing, graph identity, plugin-driver, and crash-boundary behavior |
| Speed | Refusal-only benchmark logic and `productionThroughput: 'not-claimed'` | Measured live-path throughput with an explicit threshold, or a required `speed unclaimed` verdict from the release gate |
| Release verdict | Green regression runs and lab smokes | A checked-in command that fails closed when the live-source boundary, apply-time recheck, or machine-checkable throughput verdict is absent |

## Test Coverage Verdict

The current suite is valuable, but it is still negative proof only.

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves local planning logic, stale-conflict refusal, and live-remote precondition bookkeeping. It does not prove the real apply boundary can preserve production WordPress data losslessly.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves file-backed journal sequencing, redaction, restart classification, and corruption detection. It does not prove crash survival on production storage or recovery across a live mutation.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves the benchmark model carries the right safety gates and keeps `productionThroughput` unclaimed. It does not measure the live path.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the benchmark refuses unsupported throughput claims and fails closed when tampered. It does not clear a release threshold on the production push path.

Taken together, the suite can say what should not be claimed. It cannot yet justify claims of no data loss, reliability under crash/replay, or measured speed on the live source boundary.

None of those tests is weak because it fails to assert enough detail. They are weak only in the specific sense that they stop at the wrong boundary. A release claim needs a required command that binds those guardrails to a live-source apply step; without that, the suite can still be green while the objective remains unproven.

The practical audit point is sharper than "the suite lacks coverage": the current tests are distributed guardrails with no single enforced release verdict. That means a green run can still leave auth/session, durable journal, leases/fencing, graph identity, plugin-driver, topology, and throughput claims unclosed in the same invocation.

Concrete read:

- `test/push-planner.test.js` tells us the planner refuses stale or overlapping changes, but it does not prove the source site was mutated safely.
- `test/recovery-journal.test.js` tells us the journal is consistent on local files, but it does not prove crash survival on the real storage path.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` tell us the benchmark surface refuses unsupported throughput claims, but they still leave `productionThroughput: 'not-claimed'` as a refusal, not a measurement.
- `npm test` is therefore a valid regression check and not a release gate.
- The absence of a required live-source command means the suite cannot prove no data loss, reliability under crash/replay, or speed on the real push path.

## Evidence Table

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| One-way pull base, then one-way push to the live source | Planner, refusal, and model tests prove directionality and guardrails in fixtures or lab mode | A required live-source invocation that actually mutates the source boundary in the same run | No checked-in command forces the live-source boundary, so the top release blocker remains the missing real-site push preflight command; fixture-only work cannot clear this |
| Recheck live source at apply time before mutating it | Stale-claim and replay guards show the intent in tests | Apply-time revalidation on the real source before mutation | The current suite stops before the live apply boundary |
| Preserve WordPress data shapes without loss | Local integrity checks cover some data-shape handling | Proof over rows, files, plugin-owned data, serialized payloads, and graph identity on live storage | No live-source data-shape proof exists |
| Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart | Recovery and journal tests cover file-backed and modeled recovery cases | Crash-boundary proof on production storage and transport | No release gate exercises the real crash boundary |
| Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-driver checks | Individual tests and smokes cover pieces of the matrix | One enforced release command that composes all gates and fails closed when any are missing | No mandatory command owns the release decision |
| Prove real remote/local topology | Route smokes prove shape and auth behavior | Topology proof that touches live source rather than Playground or fixture aliases | Existing smokes still self-identify as `labBacked: true` |
| Publish a measured speed claim or explicitly refuse one | Benchmark-model and guarded-benchmark tests refuse unsupported throughput claims | A machine-checkable live-path throughput verdict or an enforced `speed unclaimed` refusal from the same command | No checked-in gate prints the throughput verdict on the live path |
| Expose one required release command | Audit prose describes the needed command | A checked-in `verify`, `verify:release`, or `release` command | `package.json` has no mandatory release entrypoint, so there is no checked-in real-site push preflight command that can own the verdict |
| Wire the release command into CI or another default entrypoint | Audit notes document the gap | A checked-in workflow or default automation path that runs the gate | This checkout has no enforced workflow entrypoint |

Current reading: the repo can already refuse unsafe states, but it cannot yet issue a production release verdict. The blocker is structural: no required command owns the live-source verdict, so every green result still depends on optional evidence rather than a mandatory release gate. If the release decision is not forced through the live-source path, the repository still cannot claim no data loss, reliability, or speed.

The practical test conclusion is narrower than the release conclusion:

- the tests can prove the repository knows how to refuse unsafe states
- the tests cannot prove the repository can safely complete the live-source push
- the tests cannot prove no data loss, reliability under crash/retry, or speed on the real source boundary
- the tests cannot substitute for a required release command, even when they are all green

Actionable release criterion:

- add one checked-in command that revalidates live state, applies to the real source boundary, and prints a fail-closed verdict
- wire that command into CI or another default invocation path
- keep `speed unclaimed` as the required output until a live-path measurement is available
- treat any green run that does not include the live-source boundary as non-release evidence, even if it exercises auth/session, journal, or recovery helpers

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

The weakest claim is any sentence that treats the current green suite as proof of release readiness. That claim fails because the checked-in command surface still stops at `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers, and none of those commands must touch live source storage and emit a machine-checkable verdict in the same run. The repository can therefore still go green while the release decision remains unmade. The blocker is not "more regression coverage"; it is the absence of one enforced live-source gate.

That makes the current green status a regression signal, not a release signal. Treat every fixture, lab, refusal, or benchmark result as support evidence only until one enforced command proves the live-source apply boundary in the same invocation and fails closed when proof is missing.

- No required command exists that must reach the live-source boundary and emit a release decision from the same invocation.
- The suite can still go green without proving live-source mutation, crash survival, replay safety, or throughput on the real path.
- `speed unclaimed` is the only honest speed posture right now, but it only matters if a required gate prints it and fails closed when live-path measurement is missing.
- Any release wording that implies no data loss, reliability, or speed from the current suite alone is overstated.
- A green `node --test` run and green Playground smokes still do not prove no data loss, reliable crash recovery, or measured speed on the live-source path.
- The current test suite can reject unsafe states, but it cannot prove the objective's positive claim unless a mandatory live-source verdict is added and wired into the default release path.
- The objective's positive claim remains blocked even if the repo keeps passing `89/89`, because those passes do not yet include a required live-source verdict.
- Because that verdict is still missing from the command surface, the current evidence can only support a regression or lab narrative. It cannot close release.
- The weakest current claim is therefore any sentence that reads as if the existing green tests already certify release readiness, or that optional smokes are equivalent to a required release gate.
- Said differently: the strongest present tests prove that the repository knows how to refuse unsafe claims, not that it can make the objective's positive claims on a live source.
- The release blocker remains the missing checked-in `verify:release` or `release` command, plus the missing default automation path that would make it mandatory and prevent a green non-release run from being mistaken for live-source proof.

Actionable next step:

- add one enforced command, then wire it into the default release path, so the repository cannot be read as releasable until the live-source verdict exists
- require that command to fail closed unless it rechecks apply-time state, reaches the live-source boundary, and emits either a measured throughput result or `speed unclaimed`
- treat every other green path as support evidence only, even if it exercises auth, journal, recovery, or benchmark helpers

Actionably: the next release gate must be a checked-in command, not just a helper script, that (1) revalidates live remote state at apply time, (2) requires auth/session plus durable journal plus leases/fencing plus graph identity plus plugin-driver proof, (3) touches the live-source boundary in the same run, and (4) fails closed unless it can emit a machine-checkable release verdict. Until that exists, the strongest defensible statement is not "safe enough to release" but "safe enough to refuse unsafe claims." Any future claim of no data loss, reliability, or speed must point at that gate, not at `node --test` or the lab smokes, because those runs can still succeed without proving the live-source boundary.

## Proof Boundary

Current proof must be judged against the live-source release boundary, not against the existence of local helper paths. The following are useful inputs, but they are not release proof on their own:

- planner refusal tests that only compare fixtures and local hashes
- journal tests that only read and write local files
- benchmark tests that only model a speed claim or refuse an unsupported one
- route smokes that still report `labBacked: true`
- any proof that does not exercise the one-way pull base to one-way push to live source loop on the real release boundary

Evidence rule:

- executable proof must touch the live-source boundary in the same required invocation
- lab / fixture proof can support debugging, but it cannot close release
- docs-only proof can explain intent, but it cannot certify durability, reliability, or speed
- missing proof is a release blocker until the required gate exists and fails closed

The strongest current runnable evidence still falls into four classes:

- executable proof: none that reaches the live-source boundary; the strongest tests are [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js), but every one of them remains fixture-, model-, or refusal-backed rather than live-source-backed
- lab / fixture proof: `npm test` at `89/89` plus the optional file-backed and Playground smokes such as `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:db-journal-stale-claim-all-old`, and `test:playground:recovery`
- docs-only proof: prose in `README.md`, `progress.html`, `audits/release-blockers.md`, and the supervisor/audit notes
- missing proof: live-source apply-time mutation, durable crash survival on production storage, measured live-path throughput, an enforced `speed unclaimed` verdict when measurement is absent, and a required release gate that can fail closed when those proofs are absent

The uncomfortable conclusion is that the current tests are good enough to block overclaiming, but not good enough to support the release statements the objective asks for. They prove the suite knows how to refuse unsafe claims. They do not prove the live push path is lossless, reliable, or fast enough on the real source boundary.

## Test Audit Snapshot

| Test surface | Current proof | Unproven release claim |
| --- | --- | --- |
| `test/push-planner.test.js` | Directionality, precondition checking, local mutation ordering, and stale-plan refusal in fixture scope | A live-source push boundary, no-data-loss proof across WordPress data shapes, and real remote/local topology proof |
| `test/recovery-journal.test.js` | Local journal sequencing, redaction, restart classification, and recovery inspection against temporary files | Durable production storage, crash survival on live state, live-boundary replay safety, and final-commit durability on the real source |
| `test/performance-model.test.js` | Benchmark guardrails and refusal of unsupported throughput claims | Measured live-path throughput and any positive speed claim |
| `test/guarded-executor-benchmark.test.js` | Tamper detection, graph-identity bookkeeping, and refusal to upgrade unsupported benchmark claims without a live measurement | A release-grade performance verdict on the real push path |
| `npm test` as a whole | The repository can reject unsafe claims in lab, fixture, and model scope; `npm test` is green at `89/89` | A mandatory live-source verdict that can certify no data loss, reliability, or speed |

## Test Verdict

The current tests are strong negative evidence and weak positive evidence:

- `test/push-planner.test.js` proves the planner can refuse stale or conflicting states and preserve remote-only edits in local snapshots. It does not prove the real remote/local topology or the live-source apply boundary.
- `test/recovery-journal.test.js` proves the journal logic can serialize, redact, and restart from temporary JSONL files.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove the benchmark layer will not overclaim throughput.
- None of them prove the one-way pull base plus one-way push to live source path can safely mutate production storage, survive a live crash, or support a positive speed claim.
- Therefore `npm test` is a regression suite, not a release gate, even when it is green at `89/89`.

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
| Mandatory release gate | Optional smokes, `npm test`, and the local `plan`/`apply` wrapper | A checked-in `verify`, `verify:release`, or `release` command, plus a checked-in workflow or other default entrypoint that invokes it against `REPRINT_PUSH_SOURCE_URL` | Optional runs can bypass the live-source verdict, so the missing command remains the top release blocker |

Bottom line:

- if a claim is supported only by fixtures, Playground, lab routes, refusal tests, or prose, it remains unproven for release
- if the same invocation does not reach the live-source boundary and return a machine-checkable verdict, it is not release proof
- the release blocker is the absence of one enforced command that can fail closed on missing live-source proof

Only the first bucket would count as release proof, and it does not exist in this checkout. The current repository only has lab / fixture proof and docs-only proof, so it still falls short of the live-source release boundary. In other words, the suite can reject unsafe states, but it cannot certify a live push, no data loss, or reliable speed on the production path. A passing lab suite here is still compatible with a release that would lose writes, fail under a crash, or have no measured throughput at all.

The current test mix is therefore best read as negative evidence:

- it proves the planner refuses stale or conflicting states in local snapshots
- it proves the journal code can serialize, redact, and restart local recovery records
- it proves the benchmark model refuses unsupported throughput claims
- it does not prove that the one-way pull base plus one-way push to live source path can safely mutate live storage
- it does not prove that production durability, retry safety, or performance have been measured on the real boundary

The practical audit conclusion is therefore narrower than "the tests are incomplete": the repo lacks a mandatory live-source release gate, so the existing tests cannot be upgraded into release proof by interpretation alone. Until one checked-in command owns the live-source mutation and the speed verdict in the same run, every passing test remains support evidence only.

The hard test verdict is:

- `test/push-planner.test.js` proves the planner can model directionality, keep remote-only edits, and reject stale or conflicting local plans. It does not prove the live apply boundary preserves all production WordPress data shapes without loss.
- `test/recovery-journal.test.js` proves local-file journal ordering, redaction, restart classification, and corruption detection. It does not prove crash durability on production storage or recovery across a live mutation.
- `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove the repository refuses to overclaim speed. They do not measure real throughput on the live push path, so they cannot support a positive performance claim.
- `npm test` therefore proves refusal discipline, not release readiness. It is compatible with a release that still lacks live-source durability, topology, or throughput proof, so green regression results do not establish no data loss, reliability, or speed.

## Weakest Current Claim

The weakest claim is not "the suite needs more tests." It is "a green suite can still be mistaken for a release gate even though no checked-in `verify`, `verify:release`, or `release` command proves the live-source boundary."

That claim is only defensible if the repository has one enforced command that:

1. reaches the real live-source apply boundary in the same invocation
2. rechecks apply-time state before mutation
3. fails closed on missing auth/session, durable journal, leases/fencing, graph identity, plugin-driver, or topology proof
4. emits a machine-checkable speed verdict, including `speed unclaimed` when live-path measurement is absent

Right now none of `npm test`, `plan`, `apply`, or the optional Playground smokes does that. They remain support evidence only, and `plan` / `apply` are just local wrappers around the lab path. The repo also still has no `.github` workflow tree in this checkout, so there is no checked-in automation path that could force that gate from the default release surface.

Concrete release-gate target:

- add one checked-in command that exports `REPRINT_PUSH_SOURCE_URL`, hits a retained live-source or locally retained source endpoint, and rechecks apply-time state in the same invocation
- make that command fail closed unless it can prove auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, and preserved-remote evidence on the live boundary
- require it to emit either a measured speed verdict or an explicit `speed unclaimed` refusal, so throughput never slides in as an implicit assumption
- wire that command into the repository's default release path so optional lab helpers cannot stand in for release proof
