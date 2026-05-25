# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The blocker is structural, not cosmetic: there is no mandatory command that proves the one-way pull base plus one-way push back to the live source on the real storage and transport path. `node --test` passes, but every passing subtest remains fixture-, model-, or lab-backed, and `package.json` still exposes only `test`, `plan`, `apply`, and optional `test:playground:*` helpers. The benchmark surface is equally explicit: it returns `productionThroughput: 'not-claimed'` and blocks production throughput claims. That is negative proof, not release proof. A green test run is therefore regression evidence only; it is not a production verdict. Until a required gate closes the live-source gap, runs against the real boundary, and is wired into a mandatory entrypoint such as `npm run verify:release` or `npm run release`, `speed unclaimed` is the only defensible production-facing wording. Optional smokes can keep producing lab evidence, but they cannot collapse the missing live-source proof into a release decision or convert `productionThroughput: 'not-claimed'` into a release-ready speed claim. The actionable blocker is not a missing assertion inside the current tests; it is the absence of a mandatory release command that consumes those tests, fails closed when live-source proof remains missing, and prints an explicit machine-checkable verdict instead of silently passing. That means every green run remains blocker evidence until a mandatory live-source verdict exists.

## Evidence Table

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `node --test` proves refusal behavior, recovery classification, local integrity checks, and the benchmark stance that `productionThroughput` stays `not-claimed`. | Nothing in the current executable set reaches the one-way pull base plus one-way push to live source boundary, rechecks live state at apply time, or emits a release verdict. | A passing local suite can still leave the production decision unresolved. |
| Lab / fixture proof | Playground and authenticated smokes exercise route shape, auth/session scaffolding, journaling, stale-claim rejection, and lab-only push paths. | They remain `labBacked: true`, fixture-backed, or model-backed, so they still do not touch the live-source boundary. | Lab evidence cannot prove production no-loss, reliability, or speed. |
| Docs-only proof | The audit and blocker notes describe the intended one-way pull base plus one-way push flow. | Documentation cannot recheck live state or mutate production storage. | Prose cannot close the release gate. |
| Missing proof | Live-source mutation, crash survival on production storage, required auth/session plus journal plus lease/fencing plus graph identity plus plugin-data-driver gate, a real remote/local topology, and a measured live-path speed verdict or enforced `speed unclaimed` refusal. | These are still absent from the mandatory command surface and from [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json)'s scripts. | The repo has no enforced release verdict, so green local evidence can still bypass release. |

Current tests are therefore negative evidence only for the release claims:

- `node --test` can prove some unsafe or stale states are rejected.
- It cannot prove that the live source was mutated safely in the same run.
- It cannot prove no data was lost at the real storage boundary.
- It cannot prove crash recovery on production storage.
- It cannot prove a release-grade speed claim.
- The benchmark tests are especially explicit: they refuse unsupported throughput claims, but `productionThroughput: 'not-claimed'` remains the honest result until a mandatory release gate measures the live path.

## Weakest Current Claim

The weakest claim is the production release verdict itself.

- No required command exists that must reach the live-source boundary and emit a machine-checkable release decision.
- The suite can still go green without proving live-source mutation, crash survival, or throughput on the real path.
- `speed unclaimed` is the only honest speed posture right now, but it only matters if a required gate prints it and fails closed when live-path measurement is missing.
- Any release wording that implies no data loss, reliability, or speed from the current suite alone is overstated.
- The current test suite can reject unsafe states, but it cannot prove the objective's positive claim unless a mandatory live-source verdict is added.
- Because that verdict is still missing from the command surface, the current evidence can only support a regression or lab narrative. It cannot close release.
- The next concrete release step is a mandatory `verify:release` or `release` command that composes the existing guardrail tests, prints either a measured live-path threshold or `speed unclaimed`, and exits non-zero until that verdict is produced.

## Actionable Gate

The repo needs one checked-in command that is impossible to confuse with optional smokes:

1. run the existing guardrail suites
2. reach the live-source boundary in the same invocation
3. recheck apply-time state before mutation
4. fail closed if auth/session, journal, lease/fencing, graph identity, plugin-data-driver, or topology proof is still lab-backed
5. emit a machine-checkable verdict for throughput, either a measured threshold or `speed unclaimed`

Without that command, every passing test remains support evidence only.

## Release Summary

| Item | Current reading |
| --- | --- |
| Strongest executable proof | `node --test` plus the fixture and model suites can prove refusal behavior, classification, and local integrity checks. None of them reach the live-source boundary, and none of them can emit a mandatory release verdict. |
| Strongest lab proof | Playground and authenticated smokes can exercise route shape, auth/session scaffolding, journaling, and stale-claim rejection, but they still self-identify as `labBacked: true`. |
| Strongest docs-only proof | The audit and blocker notes correctly describe the intended one-way pull base plus one-way push flow. |
| Missing release proof | Live-source mutation, crash survival on production storage, required auth/session plus journal plus lease/fencing plus graph identity plus plugin-data-driver gate, and a measured live-path speed verdict or enforced `speed unclaimed` refusal emitted by a mandatory release command. |
| Release blocker | There is no mandatory `verify`, `verify:release`, or `release` command that can fail closed when any of those proofs are absent. |

Current reading: the repo can already refuse unsafe states, but it cannot yet issue a production release verdict. The blocker is structural: no required command owns the live-source verdict.

## Evidence At A Glance

The current audit separates proof into four buckets so the release gap stays uncomfortable and actionable:

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | Local tests and helpers prove refusal behavior, journal integrity, and modelled recovery states. | Nothing in the current executable set reaches the live-source boundary. | A passing local suite can still leave the release verdict unresolved. |
| Lab / fixture proof | Playground smokes, authenticated lab flows, and benchmark harnesses exercise the intended shapes. | They remain `labBacked: true`, fixture-backed, or model-backed. | Lab evidence cannot prove production no-loss, reliability, or speed. |
| Docs-only proof | Audits and progress notes accurately describe the intended release path. | Documentation cannot recheck live state or mutate production storage. | Prose cannot close the release gate. |
| Missing proof | Live-source apply-time recheck, durable crash survival, topology fidelity, and a measured live-path speed verdict. | These are still absent from the mandatory command surface. | The repo has no enforced release verdict. |

The current `package.json` script surface confirms the gap: it exposes `test`, `plan`, `apply`, and optional playground helpers, but no required `verify`, `verify:release`, or `release` command. That means the evidence buckets above are still support evidence, not a mandatory release decision.

Treat indirect evidence as insufficient:

- Fixture coverage can show the code is shaped correctly.
- Lab coverage can show the local flow is plausible.
- Refusal benchmarks can show unsupported claims are blocked.
- None of those prove the live source was safely mutated, recovered, and measured in one required release run.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not a bidirectional sync.
2. Recheck the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve every WordPress data shape the push can touch, including rows, files, plugin-owned data, serialized payloads, and graph identity, at the live-source boundary.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary.
5. Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes. The current `package.json` exposes only `test`, optional `test:playground:*` smokes, and `plan`/`apply`; it does not define a required `verify`, `release`, or `verify:release` command, so there is no mandatory gate that can combine those checks into one release verdict. That means the current green test surface is still optional evidence, not a release decision, and any release claim that skips a required command is overstated.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or any storage abstraction that can satisfy the tests without touching live source storage or a real apply-time mutation.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one. Refusal-only benchmarks are not a speed claim, and release language must not drift into implied speed confidence without live-path measurement. If speed stays unclaimed, that must be a deliberate release verdict emitted by the required gate, not an accidental omission or docs-only aside. The release command should fail closed unless it can print that refusal explicitly, and `speed unclaimed` should be treated as an enforced outcome rather than a placeholder. In this checkout, speed is not pending; it is blocked until a required gate can emit a live-path measurement or the explicit refusal, and the verdict must be machine-checkable in the same run that validates the live-source boundary. Optional smokes and refusal benchmarks are therefore support evidence only: they can keep the claim blocked, but they cannot satisfy the release verdict by themselves. The practical release rule is stricter: if the repo cannot emit a live-path threshold, the required command must surface `speed unclaimed` and exit non-zero so the missing measurement is impossible to miss. The current script surface still lacks that required gate, so the speed claim remains release-blocked rather than merely unmeasured.
8. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
9. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix. This checkout has no `.github/` workflow directory, so there is no checked-in CI path that can enforce the release decision, and no alternative mandatory entrypoint exists in `package.json` to compensate.
10. Make the release command print an explicit verdict for throughput. If the repo cannot measure live-path speed, the command must surface `speed unclaimed` and fail closed on any attempt to imply a production speed claim. The output must be unambiguous enough that CI or a reviewer can tell whether the release decided speed or merely skipped it, and the command must be mandatory rather than optional. The required command should therefore be easy to grep for in CI logs, not hidden inside a helper script or a docs note.
11. Keep optional smokes available for local evidence collection, but do not let them stand in for release proof.

Release gate rule: one mandatory command must reach the live-source boundary and print a machine-checkable verdict in the same run. That verdict must be either a measured live-path threshold or an explicit `speed unclaimed` decision. Any green path that does not emit that verdict remains blocker evidence, not release proof. If the command does not exist, the repo does not have a release gate.

Current command surface confirms the gap: `package.json` exposes `test`, `plan`, `apply`, and optional `test:playground:*` helpers, but no required `verify`, `release`, or `verify:release` entrypoint that can force the live-source verdict. In other words, the repo can still go green without making the release decision.

## Requirement Map

Proof buckets used below:

- `Executable proof` means a required command or test reaches the live-source boundary and can fail the release.
- `Lab / fixture proof` means the evidence is real code execution, but it is still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof` means prose, labels, or audit statements with no executable boundary.
- `Missing proof` means the repo has no current evidence for the requirement at the release boundary.
- `Release blocker` states why the requirement still cannot be promoted.

| Requirement | Executable proof | Lab / fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, then one-way push to live source | No executable proof reaches the live-source boundary | Planner, authenticated, and Playground smokes stay `labBacked: true` | Audit prose names the one-way flow | No required run mutates live source after the pull base in the same command | Directional intent is not enough until the live source is mutated in the same run |
| Live recheck at apply time | Fixture tests require live remote preconditions in model scope | Stale-claim rejection is covered in lab smokes | Audit prose says apply must recheck live state | No production apply gate proves the recheck happens against the real source immediately before mutation | A stale preflight can still pass unless the live boundary is enforced |
| WordPress shape coverage | Benchmark and journal tests cover modeled rows, files, and graph identity | Playground smokes exercise a subset of those shapes | Audit prose names the shapes that must survive | No production-shaped gate proves every touched shape survives on live storage | Partial shape coverage is not a release claim |
| Crash/retry/replay safety | Recovery and journal tests cover restart classifications | File-backed journal fixtures simulate restarts and corruption | Audit prose names crash, retry, replay, duplicate, and lease-expiry cases | No crash boundary proof on live storage, duplicate-request proof, or stale-lease proof | Restart classes in fixtures do not prove durability on the real source |
| Auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver | Benchmark report assembles several evidence slices in one model run | Optional smokes cover pieces of the matrix | Audit prose names the required checks | No single required command composes all of them at release time | Disconnected coverage cannot be promoted to a release gate |
| Real remote/local topology | Some smokes exercise lab routes and local aliases | Playground routes run against a local fixture topology | Audit prose notes the topology requirement | No checked-in required gate proves a real remote/local topology instead of a lab-backed route | Lab topology can satisfy tests while the live source remains unproven |
| Speed claim or explicit refusal | [`scripts/bench/guarded-executor-benchmark.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/scripts/bench/guarded-executor-benchmark.js) and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) refuse unsupported throughput claims and emit `productionThroughput: 'not-claimed'` | Benchmark model runs stay lab-shaped | Audit prose says `speed unclaimed` is the only defensible wording until measured | No measured live-path speed result and no required release command that must print `speed unclaimed` or a threshold in the same run; `package.json` still exposes only `test`, `plan`, `apply`, and optional Playground smokes | Refusal-only evidence blocks overclaiming but does not make the release decision; the required gate must explicitly emit `speed unclaimed` or a threshold, and a green run without that verdict is still a blocker. Put differently, the benchmark proves a claim is blocked, but it does not prove the repo has a mandatory release verdict for that block. |
| Required release entrypoint | None | None | Audit prose names a required release command | No `verify`, `release`, or `verify:release` script in `package.json`; this checkout also has no checked-in workflow directory; nothing enforces a machine-checkable `speed unclaimed` or measured threshold verdict | Green optional runs can bypass the release decision entirely, so the repo still has no mandatory place where the live-source verdict must appear |

The sharpest practical reading is this: `node --test` and the optional Playground smokes are now best treated as refusal and regression evidence only. They may preserve the blocker, but they do not themselves decide release, and they do not prove the live-source boundary.

## Test Audit

The strongest current tests are guardrails, not release proof. They are worth keeping, but they do not close the objective on their own. In particular, they do not prove the three release claims the objective cares about most, and they do not replace the missing mandatory release command that would have to turn those claims into a single verdict. A passing `node --test` run is regression evidence only, and the current `package.json` surface confirms why: there is still no required `verify`, `verify:release`, or `release` command that could force the live-source verdict.

- `No data loss`: [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves monotonic local journal sequencing, redaction, and restart classification in temp-file storage. [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves precondition modelling and conflict refusal. Neither test writes to the live-source boundary and then re-reads it to prove no loss, no duplication, or no reordering on production storage.
- `Reliable`: the suite proves refusal behavior, restart states, and local journal integrity, but no current test composes auth/session, durable journal, leases/fencing, graph identity, and plugin-data-driver checks into one enforced release decision against real storage. The current passes are distributed across helper paths, not concentrated in a required gate.
- `Fast`: [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) is explicit anti-claim evidence. It asserts `report.throughput.productionThroughput === 'not-claimed'`, rejects unsupported production throughput claims, and verifies blocker lists. That is useful because it prevents overclaiming, but it is not a measured live-path speed result, not a release threshold, and not a mandatory verdict emitted by a release command. If anything, it proves the suite can block a speed claim while still leaving the release gate absent.

The sharpest test verdict is therefore negative: the current tests are good at proving what the repo must refuse, but they do not prove the live-source path succeeds under the release boundary. That means the suite is suitable as guardrail evidence and regression evidence only until a mandatory release command exists.

Test readout, in release terms:

| Claim | What the tests actually prove | What they do not prove |
| --- | --- | --- |
| No data loss | Fixture and journal replay classifications, redaction, and restart-state handling | Live-source mutation survival, no-loss recovery on production storage, or duplicate/replay safety at the live boundary |
| Reliable | Refusal behavior, precondition modelling, and local journal integrity | A mandatory release gate that composes auth/session, durable journal, leases/fencing, graph identity, and plugin-data-driver checks on the real path |
| Fast | Unsupported throughput claims are refused and `productionThroughput` stays `not-claimed` | Any positive live-path throughput claim, threshold, or machine-checkable release verdict |

The test surface also reveals a structural gap in how release evidence is collected. `npm test` proves the negative cases stay negative, but the repo has no required `verify`/`release`/`verify:release` entrypoint to force the live-source verdict. Optional Playground commands and local journal tests can keep improving confidence, but they remain optional and therefore cannot be the final release decision. That means the suite cannot be promoted from regression evidence to release proof without first adding a mandatory command that prints the live-source verdict in the same run.

Strict reading: if a test only proves refusal, redaction, replay classification, or local fixture integrity, it cannot be upgraded to `no data loss`, `reliable`, or `fast` at the live-source boundary. The only honest release-language outcome for the current suite is that those claims remain unproven until a mandatory live-source gate exists.

The pattern across the suite is consistent: it is better at proving that unsafe claims are blocked than at proving the live-source release claims themselves.

Put bluntly: the current suite can prove that unsafe claims are refused, but it cannot prove that the live source was mutated safely, recovered safely, and measured safely in the same release run. That gap is the release blocker, not a cosmetic documentation issue.

| Evidence class | Current state | Release reading |
| --- | --- | --- |
| Executable proof | Present only for fixture, model, and refusal behavior in `test/push-planner.test.js`, `test/recovery-journal.test.js`, `test/guarded-executor-benchmark.test.js`, and the helper scripts they exercise | Useful for regression and blocker preservation, not for release promotion |
| Lab / fixture proof | Present in `npm run test:playground:*`, local journals, and benchmark harnesses | Useful evidence of behavior under controlled inputs, but still not live-source proof |
| Docs-only proof | Present in audits, progress pages, and blocker notes | Advisory only; cannot close the release gap |
| Missing proof | Live-source mutation, crash survival on production storage, enforced release entrypoint, measured throughput | These are the missing gates that keep the objective blocked |
| Release blocker | The repo can still pass without proving the live boundary | No production release claim should be made yet |

Release closure requires all of the following to be true in one mandatory command:

1. the live source is rechecked at apply time,
2. auth/session and lease/fencing checks are enforced on the live path,
3. durable journal evidence survives a crash boundary on real storage,
4. graph identity and plugin-data-driver checks are proven on the live topology,
5. the command prints either a measured live-path threshold or an explicit `speed unclaimed` verdict,
6. the command fails closed if any part of that matrix is still lab-backed, fixture-backed, or benchmark-only.

| Test surface | What it really proves | What it does not prove | Release reading |
| --- | --- | --- | --- |
| `test/push-planner.test.js` | Directional planning rules, stale-claim rejection, plugin-owner checks, and recovery classification in controlled fixtures | Live-source mutation, production no-loss behavior, real remote/local topology, or crash survival on production storage | Useful refusal and shape proof only; still not a live-source release gate |
| `test/recovery-journal.test.js` | File-backed journal sequencing, redaction, and restart inspection in local temp storage | Durable production storage, fencing against concurrent workers, or live-boundary replay after a crash | Local durability model only; still not a live-source release gate |
| `test/performance-model.test.js` | Internal benchmark guardrails and rejection of unsupported speed claims | Measured live-path throughput or any release-grade speed threshold | Explicit anti-claim evidence only; still not a release speed decision |
| `test/guarded-executor-benchmark.test.js` | Integrity checks and the current `productionThroughput: 'not-claimed'` stance | Any positive speed claim, a measured threshold, or a required release verdict | Refusal proof, not throughput proof; still not a release verdict |
| Optional `test:playground:*` smokes | Lab-shaped route, auth, journal, and file-transfer scenarios that can be run manually | Any enforced release gate, any non-lab storage boundary, or any proof the live source was mutated safely | Helpful lab evidence, but still not release proof and not a substitute for a required command |
| [`audits/release-blockers.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/release-blockers.md) | A short, docs-only blocker summary that matches the current release boundary | Any executable proof or release gate | Useful for audit context only |

The uncomfortable conclusion is that the current tests are good enough to block overclaiming, but not good enough to support the release statements the objective asks for. They prove the suite knows how to refuse unsafe claims. They do not prove the live push path is lossless, reliable, or fast enough.

## Proof Boundary

Current proof must be judged against the live-source release boundary, not against the existence of local helper paths. The following are useful inputs, but they are not release proof on their own:

- planner refusal tests that only compare fixtures and local hashes
- journal tests that only read and write local files
- benchmark tests that only model a speed claim or refuse an unsupported one
- route smokes that still report `labBacked: true`
- any proof that does not exercise the one-way pull base to one-way push to live source loop on the real release boundary

Indirect evidence is not enough here: a route name, a `labBacked` label, a docs paragraph, or a passing optional smoke can support the audit, but none of them can promote a missing live-source run into release proof.

The strongest current runnable evidence still falls into four classes:

- executable proof: none that reaches the live-source boundary; the strongest tests are [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js), but every one of them remains fixture-, model-, or refusal-backed rather than live-source-backed
- lab / fixture proof: `npm test` plus the optional file-backed and Playground smokes
- docs-only proof: prose in `README.md`, `progress.html`, `audits/release-blockers.md`, and the supervisor/audit notes
- missing proof: live-source apply-time mutation, durable crash survival on production storage, measured live-path throughput, an enforced `speed unclaimed` verdict when measurement is absent, and a required release gate that can fail closed when those proofs are absent

The test gap matters because the current suite has no executable proof of the production claim itself. It can only validate smaller premises:

- planner tests prove the plan can refuse stale or conflicting inputs
- journal tests prove local files can persist and be replayed
- benchmark tests prove unsupported throughput claims are rejected
- none of them prove the live-source boundary that the objective requires

The test surfaces themselves are not stronger than that evidence boundary. [`audits/test-proof-audit.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/test-proof-audit.md) records the same limit from the test side: the suite proves guardrails and refusals, not no data loss, reliability, or speed at the live-source boundary.

## Evidence Table

| Evidence class | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `node --test` passes across planner, recovery journal, and guarded benchmark tests | It is still local, model-driven, or fixture-backed and does not reach the live-source boundary | Useful regression coverage only |
| Lab / fixture proof | Playground smokes and temp-file journal tests exercise auth, journal, and route shapes | The live source, real storage boundary, and release topology are not proven | Cannot close a production release claim |
| Docs-only proof | Audit text, lane notes, and `labBacked: true` labels describe the intended safety matrix | Descriptions do not mutate the live source or enforce the gate | Informative only; never release proof |
| Missing proof | No required `verify` / `release` / `verify:release` script, no checked-in `.github/workflows/` entrypoint, no measured live-path throughput, no live-source mutation proof, no mandatory `speed unclaimed` verdict emitted by a required gate | The objective requires a mandatory, production-bound release decision | Blocks release because the repo can still go green without making that decision |
| Release blockers | `speed unclaimed` remains unproven by a required command, live-source boundary not exercised, safety matrix not composed in one entrypoint | Any green optional run can still bypass the real release decision | Hard blocker |

Only the first bucket would count as release proof, and it does not exist in this checkout. The current repository only has lab / fixture proof and docs-only proof, so it still falls short of the live-source release boundary. In other words, the suite can reject unsafe states, but it cannot certify a live push, no data loss, or reliable speed on the production path. A passing lab suite here is still compatible with a release that would lose writes, fail under a crash, or have no measured throughput at all. Until a required release command reaches the live source, a green test run remains regression evidence only.

For a narrower test-by-test breakdown, see [`audits/test-proof-audit.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/audits/test-proof-audit.md).

## Required Release Gate

The repo still needs one enforced release gate that closes the gap between lab evidence and a releasable live push path. That gate must fail closed unless it can prove, in the same run, all of the following:

1. live-source boundary validation at apply time
2. durable journal evidence that survives crash/retry/replay cases
3. lease/fencing enforcement against stale or duplicate claims
4. graph identity and plugin-data-driver coverage for the WordPress shapes this push can touch
5. a real remote/local topology, not a fixture-only or Playground-only alias
6. either a measured live-path throughput result or an explicit refusal to claim throughput

Current command reality is narrower than that gate:

- `npm test` runs the Node suite only.
- `npm run test:playground` chains local Playground plan/apply/push protocol smokes.
- the stronger playground commands remain optional and can be skipped entirely.

Until that gate exists and is wired into a default entrypoint such as `npm run verify:release` or `npm run release`, the project can only claim lab proof, not production release readiness. A green run that comes only from optional smokes, fixture tests, or benchmark refusal paths is still insufficient on its own because it can bypass the live-source release decision entirely.

## Evidence Table

The backlog asks for a strict split between executable proof, lab / fixture proof, docs-only proof, missing proof, and release blockers. This table uses those buckets directly so the audit cannot blur them together. The important rule is that only executable proof that reaches the live-source boundary can count as release proof; everything else is support evidence, not a release verdict.

| Requirement | Executable proof | Lab / fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, then one-way push to live source | None that reaches the live-source boundary | Optional smokes such as `npm run test:playground:http-push`, `npm run test:playground:authenticated-http-push`, `npm run test:playground:production-shaped-push`, and `npm run test:playground:db-journal-idempotency` exercise the lab route shape, auth/session scaffolding, storage guards, and journal replay states; `test/push-planner.test.js`, `test/recovery-journal.test.js`, `test/performance-model.test.js`, and `test/guarded-executor-benchmark.test.js` are still regression/model/refusal evidence only | `README.md`, `supervision/README.md`, and the audit notes describe the intended release flow | No live-source apply path on the production boundary, and no default `verify`, `verify:release`, or `release` script can force it | Directional intent is not enough until the live source is mutated in the same run |
| Live recheck at apply time | Planner tests and refusal paths validate stale-state handling in fixtures | Lab smokes cover stale-claim and storage-guard scenarios; the planner and journal tests can only model the recheck, not prove it against live storage | Audit notes describe the safety intent | No production apply gate proves the recheck happens against the real source before mutation | A stale preflight can still pass unless the live boundary is enforced |
| WordPress shape coverage | No executable proof covers every touched shape on live storage | Lab tests and smokes cover rows, files, plugin-owned data, serialized payloads, and graph identity only in modeled or local form | Protocol and scenario docs enumerate the shapes the system cares about | No production-shaped gate proves every touched shape survives on live storage | Partial shape coverage is not a release claim |
| Crash / retry / replay safety | Recovery tests cover restart classifications in local files | Optional smokes cover restart and stale-state scenarios in lab mode | Audit notes describe the failure classes | No crash-boundary proof on live storage, duplicate-request proof, or stale-lease proof | Restart classes in fixtures do not prove durability on the real source |
| Auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver | No single executable proof composes the full matrix | Optional smokes exercise pieces of the matrix | Audit prose lists the required checks | No required release command enforces all of them together | Disconnected coverage cannot be promoted to a release gate |
| Real remote/local topology | No executable proof uses the real topology | Existing smokes are explicitly lab-scoped or fixture-backed | Docs describe the intended topology | No checked-in release gate validates topology on the live path | Lab topology can satisfy tests while the live source remains unproven |
| Speed claim or explicit refusal | [`scripts/bench/guarded-executor-benchmark.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/scripts/bench/guarded-executor-benchmark.js) and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) refuse unsupported claims and expose `productionThroughput: 'not-claimed'` | The benchmark surface is refusal-only and stays lab-shaped | Audit notes refuse the claim | No production-speed threshold is verified, and no mandatory command prints `speed unclaimed` as a release verdict; the repo still has no `verify`, `release`, or `verify:release` entrypoint, so there is no machine-checkable speed decision at the live-source boundary | Refusal-only evidence blocks overclaiming but does not release the speed claim |
| Required release entrypoint | None | Optional smokes exist, but they are not mandatory | Audit notes describe the needed gate | `package.json` has no `verify`, `release`, or `verify:release` script; this checkout also has no checked-in workflow directory | Green optional runs can bypass the live-source release decision entirely |

## Evidence Summary

The strongest current runnable evidence still falls into the following classes:

- executable proof: none that reaches the live-source boundary; the strongest tests are [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js), but every one of them remains fixture-, model-, or refusal-backed rather than live-source-backed
- lab / fixture proof: `npm test` plus the optional file-backed and Playground smokes
- docs-only proof: prose in `README.md`, `progress.html`, and the supervisor/audit notes
- missing proof: live-source apply-time mutation, durable crash survival on production storage, measured live-path throughput, explicit `speed unclaimed` release verdicts, and a required release gate that can fail closed when those proofs are absent

## Test Audit

The current tests are useful, but they are not proof of no data loss, reliability, or speed at the production boundary. They mostly prove that the lab harness is internally consistent and that unsafe claims are refused. That is necessary guardrail coverage, not release evidence. The suite still stops short of proving the live-source loop, so every positive interpretation must stay limited to lab scope. In particular, `node --test` passing is still compatible with a release that would lose data, fail under a crash, or miss a throughput threshold on the live boundary, because the suite never forces that boundary or a production storage backend. Passing tests here are best read as "the release should not be trusted yet", not as "the release is safe". The strongest current tests remain refusal or model evidence only: `test/push-planner.test.js` checks directional rules and stale-claim rejection, `test/recovery-journal.test.js` checks local journal replay and restart classification, and the benchmark tests only reject unsupported speed claims. None of them prove a live-source mutation, a crash boundary on real storage, or a measured live-path throughput verdict.

That matters because the objective is not just "tests pass." It is "the repo can make a release decision that reaches the live-source boundary and fails closed when proof is missing." Today the suite cannot do that. It can demonstrate that unsafe states are recognized in fixtures and that unsupported speed claims are refused, but it cannot prove the production push is lossless, reliable, or fast enough. A green test run therefore remains regression evidence only.

The practical audit conclusion is stricter than "tests are incomplete":

- no current test proves the one-way pull base plus one-way push back to the live source in the same run
- no current test proves durability, replay safety, or crash recovery on the real source of truth
- no current test proves the auth/session, journal, lease/fence, graph identity, and plugin-data-driver requirements as a single release gate
- no current test can convert `productionThroughput: 'not-claimed'` into a measured live-path speed claim
- no current test can replace the missing mandatory release command, so passing tests remain support evidence rather than release proof

The strongest remaining claim the suite can make is narrower: it can show that unsupported production claims are rejected. It cannot show that a production claim is true. For the claim audit, that means no data loss remains unproven, reliability remains unproven, and speed is still explicitly unclaimed.

That means the current test suite can support a blocker note, but it cannot serve as the release gate itself. Any green run that only exercises these tests still leaves the live-source verdict open.

The strongest test files deserve a stricter reading:

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves planner invariants and refusal behavior for modeled inputs, not that a live source is mutated safely.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves local journal structure, restart classification, and redaction, not durable no-loss recovery on production storage.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves the model can describe and refuse throughput claims, not that the live path is fast enough.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves a benchmark claim stays blocked until missing production evidence exists, which is helpful anti-claim evidence but still not a speed result.

So the test suite currently proves three things and only three things at the release boundary:

1. unsafe claims can be refused,
2. lab and fixture states can be classified consistently, and
3. the audit can detect missing proof.

It does not prove no data loss, reliability, or speed on the real release path, and it does not substitute for a required release command that must fail closed on missing live-source evidence. Put differently: `node --test` can pass while the production release is still blocked, and every passing test still needs to be read as `labBacked: true` unless it reaches the live-source boundary. Because [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still lacks a mandatory `verify`, `release`, or `verify:release` script, there is no checked-in command that can force the release verdict, so the suite remains audit evidence rather than deployment proof.

Release inference rule: if a test only shows fixture integrity, redaction, refusal, or lab replay, it can support a blocker note, but it cannot support `no data loss`, `reliable`, or `fast` at the live-source boundary.

| Test surface | What it proves | What it does not prove | Release value |
| --- | --- | --- | --- |
| [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and `npm test` | Planner refusal, remote-change protection, local deletion blocking, plugin-owned data blocking, and fixture-level conflict handling | No live-source mutation, no production storage boundary, no end-to-end no-loss proof, no real remote/local topology, and no evidence that production writes survive retries, crashes, stale claims, or duplicate apply attempts. These tests prove the planner can reject unsafe states, not that a release path can safely mutate production storage. | Blocker evidence only; local correctness only |
| [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | File-backed journal monotonicity, redaction, restart classification, and blocked recovery states | No durable production journal, no lease/fencing regime, no real crash recovery on the source boundary, no duplicate/write-loss proof on live storage, and no evidence that a live apply is replay-safe under the production storage semantics named by the objective. The journal tests stop at local correctness and do not prove the journal can survive a live apply crash boundary. | Blocker evidence only; crash durability still unproven |
| [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) | Benchmark shape, guardrails, refusal discipline, and safe-fast-path modeling | No measured throughput, no memory ceiling, no runtime threshold on a live push path, no production timing evidence, no proof that the speed story is anything more than a model or refusal gate. This suite is descriptive, not a live-path benchmark, so it cannot support a production speed claim or prove that the live path is fast enough. | Blocker evidence only; not a speed result |
| [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | Explicit refusal of unsupported throughput claims and tamper detection for benchmark evidence | No positive speed claim, no production-shaped timing result, no live-path benchmark threshold, no real live-source throughput measurement, no proof that a production release is fast enough, and no enforced default entrypoint that turns the refusal into a release gate. It proves the claim is blocked, not that the block has been cleared, and it should stay that way until a measured live-path result exists. The current report is intentionally `not-claimed`, which is blocker-preserving evidence rather than speed proof, and `productionThroughput: 'not-claimed'` is not a release verdict unless a mandatory command prints it. By itself, it cannot prove speed, reliability, or no data loss on the live boundary. | Blocker evidence only; refusal-only benchmark |
| `npm run test:playground:*` optional smokes, including `http-push` and `authenticated-http-push` | Lab/fixture route shape, auth/session scaffolding, storage guard behavior, stale-claim classification, and journal smoke paths | No real remote/local topology, no production storage path, no enforced release gate, and no release decision because the smokes remain optional; the client and route still label themselves `labBacked: true` | Lab evidence only; cannot upgrade the missing live-source proof |

These tests can justify a cautious lab narrative. They do not justify a release narrative for the one-way pull base plus one-way push back to the live source.

## Claim Audit

The user-facing claims fail for the same reason: the suite stops at guarded models and lab flows.

- `No data loss`: the recovery tests prove monotonic journals, redaction, and restart classification on fixture-backed storage, but they do not prove a live-source apply can survive a crash, retry, or duplicate replay without loss at the production storage boundary.
- `Reliable`: the tests prove refusal behavior, restart states, and local journal integrity, but they do not prove the one-way pull base plus one-way push back to live source is durable under the production storage semantics named by the objective, nor that stale claims and mid-apply restarts are safe on live storage.
- `Fast`: the benchmark suite is intentionally refusal-first. It can reject unsupported throughput claims, but it does not report a measured live-path throughput result or a release threshold for production speed. Until that changes, release-facing copy should not imply positive throughput, and the required gate still needs to emit `speed unclaimed` or a threshold at the live-source boundary.

The weakest claim remains speed, and it is the easiest one to overstate because the repo has no measured live-path number, no release threshold, and no enforced gate that fails closed on the missing measurement. That means even a perfect lab auth/journal story would still leave the production speed claim blocked. The audit should treat any future throughput language as release-blocked until it is tied to the live-source boundary, an explicit threshold, and a required command that fails when `productionThroughput` is still `not-claimed`. If the project intends to keep speed unclaimed, the audit should say that plainly rather than letting the absence of a number read like a deferred approval. The important distinction is that `speed unclaimed` is a release decision, while `speed not measured` would still be incomplete, and the current scripts do not yet contain a mandatory release entrypoint that can make that decision. Silent omission is not an acceptable middle state. In practical terms, the current benchmark files prove only that unsupported throughput claims are refused; they do not prove the live push path is fast enough, and they do not create a release verdict by themselves. The release-safe reading is therefore: `speed unclaimed` until a mandatory live-path gate exists, and any green optional smoke or refusal-only benchmark remains non-gating evidence. The audit should not soften that into "pending measurement"; it is blocked until a required command can emit the verdict. Release reviewers should treat any report that omits this verdict as incomplete, even if all optional smokes pass.

The current test suite proves negative claims better than positive release claims. It proves that unsupported throughput can be refused, but it does not prove a production throughput floor or a live-path SLO. That means the safest release-language reading is not "fast enough is likely", but "fastness is intentionally unclaimed until the required gate exists". Any softer reading would overstate what the tests actually cover, and any claim of no data loss or reliability would be equally overstated because the suite never reaches the live-source boundary that would be needed to prove them.

For release purposes, the three claims should be read this way:

- `No data loss`: unproven at the live-source boundary; current tests only prove guarded local and fixture replay behavior.
- `Reliable`: unproven at the live-source boundary; current tests only prove refusal, restart classification, and journal integrity in lab storage.
- `Fast`: intentionally unclaimed until a mandatory release command prints a live-path verdict or an explicit `speed unclaimed` failure.

That also means the release gate must be opinionated enough to reject a green run that never reaches the live-source verdict. A command that only replays fixture checks or optional smokes and then exits zero is not a release decision, even if it accurately refuses to claim throughput. The required gate has to surface one of two outcomes in the same run: a measured live-path throughput result, or an explicit `speed unclaimed` verdict that is part of the release decision itself.

The actionable rule is simple: add one default release command, wire it into CI, and make it print either a measured live-path throughput result or a deliberate `speed unclaimed` verdict. Anything softer than that still leaves the release language ambiguous, because optional smokes and refusal-only benchmarks can prove the project is cautious without proving the live push path is ready. The command should fail closed if it cannot emit one of those two outcomes in the same run.

## Release Blockers

The objective stays blocked for five concrete reasons:

1. There is no single required release command in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real remote/local topology, crash boundary, recovery, and a measured live-path speed check. The only top-level entrypoints are `test`, `plan`, `apply`, and optional `test:playground:*` helpers, so `npm test` can stay green while the live-source verdict remains missing. Until that changes, the repo has no mandatory place to emit `speed unclaimed` as a release verdict.
2. The strongest authenticated push route still self-identifies as `labBacked: true` in [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js#L63-L73), and the route surface echoes that same label in [`scripts/playground/push-remote-rest-plugin.php`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/scripts/playground/push-remote-rest-plugin.php#L3118-L3126), so the best visible push evidence is still lab-scoped and cannot be treated as a production release proof.
3. The benchmark tests are refusal-only. They prove the suite can reject unsupported throughput claims, but they do not measure the live push path, publish a live-path threshold, or establish a production release speed claim. A refusal-only benchmark is anti-claim evidence, not speed proof, and should be treated as a guardrail until a measured live-path result exists. If the repo intends to keep speed unclaimed, that decision still needs a required command that says so explicitly, and release copy must say `speed unclaimed` rather than silently omitting the claim. Optional smokes cannot satisfy this requirement because they are not mandatory, and the current command surface still lacks a `verify:release` or `release` entrypoint that could make the refusal binding. That missing entrypoint is the operational blocker, not just the missing metric. The actionable fix is a mandatory command that either prints a live-path throughput threshold or prints `speed unclaimed` and exits non-zero when live-source proof is still missing.
4. The current recovery and journal tests are fixture-backed. They prove local model behavior, not durable production storage on the live source boundary. In particular, they do not prove the apply-time live-source recheck that must happen immediately before mutation, and they do not exercise a real remote-to-local-to-remote release path or no-loss behavior under the production storage semantics named by the objective.
5. There is no checked-in CI workflow in this checkout and no `verify`/`release`/`verify:release` script in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), so there is no visible enforced entrypoint that could make the required release gate mandatory or close the loop from proof to deployable gate. Optional smokes, including the `production-shaped` route path and `http-push`, can still be run directly, which means the repository can report local success without proving the live-source boundary or producing a release-grade speed measurement. A green optional run still leaves the mandatory verdict missing, so `speed unclaimed` remains a release requirement rather than an audit suggestion.
6. The benchmark suite is intentionally refusal-first: `report.throughput.productionThroughput` stays `not-claimed`, and the speed claim tests only prove the gate refuses unsupported production throughput until the missing measurements exist. That is a blocker-preserving design, not throughput proof, and it cannot substitute for a mandatory release command that prints the verdict itself.
7. The tests that look strongest are still proving preconditions, redaction, and refusal behavior, not end-to-end mutation safety under a crash boundary. That is useful, but it is not release evidence.
8. The current benchmark surfaces are explicitly refusal-oriented; they are acceptable as anti-claim evidence, but they still do not establish a live-path speed claim.
9. The lab route coverage is still self-described as `labBacked: true` on the strongest push paths, so even the authenticated success cases remain local proof, not production release proof.
10. No test or smoke in this checkout demonstrates the one-way pull base plus one-way push back to live source under the production storage semantics named by the objective.
11. The repository still has no measured live-path throughput result, so speed is blocked even if all of the lab safety claims remain green.

Those blockers are actionable, not abstract: the repo needs one mandatory command that reaches the live-source boundary, proves the release safety matrix in one run, and either prints a measured throughput result or explicitly prints `speed unclaimed` before it can be treated as releasable. If it cannot emit one of those two verdicts, the run is not a release decision.

The weakest claim is speed, and the audit should keep treating it as blocked until there is a measured live-path number with a threshold. The practical consequence is simple: do not convert the current refusal-only benchmark into release language, and do not let any docs or smoke output suggest `fast`, `performant`, or `production-ready` until the required gate speaks for itself. If the repo cannot measure production throughput yet, the release gate should fail closed on that missing measurement instead of implying performance confidence from models or smokes. A refusal-only benchmark is useful because it prevents overclaiming, but it is not evidence that the live push path is fast enough. Release copy should therefore say `speed unclaimed` until the live-path benchmark exists and is wired into a required gate that exits non-zero when `productionThroughput` is still `not-claimed`. Treat any other phrasing as a release blocker, not a placeholder. A passing `node --test` run must not be allowed to imply speed confidence by omission; the only acceptable release verdict is an explicit measured threshold or an explicit `speed unclaimed` result from the mandatory release command. Right now there is no such command, so `speed unclaimed` is not just the safest wording; it is the only release wording that matches the current command surface and should be treated as a required release verdict, not an audit note.

The repository still has only refusal-only throughput evidence, no measured live-path result, and no enforced threshold that would let the project say anything positive about production speed. Until that changes, the only defensible statement is that unsupported throughput claims are rejected. The release gate should therefore require a positive live-path measurement or fail the run, rather than allowing a green benchmark refusal to masquerade as performance proof. A passing refusal benchmark is acceptable only if the required gate also emits the explicit `speed unclaimed` decision. If that verdict is not printed by the mandatory command, the run is not a release decision, even if every optional smoke passes.

Treat `speed unclaimed` as an explicit release verdict, not a soft omission. If the required command cannot print that verdict in the same run as the rest of the release checks, then the command has not actually made a production speed decision and should fail closed.

## Claim Status

| Claim | Current status | What would be needed to release it |
| --- | --- | --- |
| `No data loss` | Not proven at the live-source boundary | A required live-path gate that survives crash, retry, replay, duplicate claim, stale lease, and mid-apply restart on production storage; current `node --test` coverage only proves the model and fixture classifications, not the live mutation boundary or durable storage path |
| `Reliable` | Not proven at the live-source boundary | Enforced auth/session, durable journal, leases/fencing, graph identity, and plugin-driver checks in one default release command; optional smokes and helper scripts do not compose into release proof, and the current command surface still has no mandatory release entrypoint |
| `Fast` | Blocked until a mandatory command prints either a measured live-path throughput threshold or `speed unclaimed` | A required release command that fails closed whenever throughput remains `not-claimed`; a green refusal-only test run is not enough, optional smokes must never stand in for that verdict, and the current benchmark suite must not be misread as speed proof. Until that command exists, `speed unclaimed` is the only release-safe wording, and it must be emitted by the release command itself, not inferred from audit prose or optional smoke output. The speed verdict is missing as a required command output, so the blocker is operational as well as evidentiary. The current state is not "fast but unmeasured"; it is "speed blocked until a mandatory command says otherwise." The release gate must own that wording, or speed remains unreleasable. This is the weakest claim because it needs a machine-checkable release verdict, not just better benchmarks. |

## Proof Matrix

This matrix keeps the audit aligned with the backlog requirement to separate executable proof from lab, fixture, and docs-only evidence.

| Requirement area | Executable proof | Lab / fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, then one-way push to live source | None at the live-source boundary | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) stay local, modelled, or lab-backed | Objective audit language names the direction, but not a live run | No required command mutates live source in the same run | Directional intent is not release proof until the live boundary is exercised |
| Live recheck at apply time | Fixture tests require live-remote preconditions in model scope | Stale-claim rejection is covered in lab smokes | Audit prose says apply must recheck live state | No production apply gate proves the recheck happens against the real source immediately before mutation | A stale preflight can still pass unless the live boundary is enforced at apply time |
| No data loss | Model and fixture checks for restart, redaction, and state recovery | File-backed journal and Playground smokes | Test audit prose explains the gap | No live-storage no-loss proof | Live-source mutation safety remains unproven, so the claim is blocked |
| Reliability | Guardrail tests for refusal, tamper detection, and classification | Authenticated and production-shaped smokes remain `labBacked: true` | Audit prose lists required gate components | No default release command composes auth/session, journal, leases, identity, and driver checks | The repo can go green without proving the release matrix |
| Speed | Refusal-only benchmark assertions | Benchmark model stays `productionThroughput: 'not-claimed'` | Audit prose says `speed unclaimed` is the only safe wording | No measured live-path throughput or mandatory release verdict | Throughput cannot be promoted beyond blocker status; the release gate still needs to print `speed unclaimed` or a threshold itself, and if it cannot, release must fail closed |
| Mandatory release command | None | Optional `test`, `plan`, `apply`, and playground smokes only | Audit prose and blockers note the missing gate | No checked-in `verify:release`/`release` entrypoint exists | A green default run can still bypass the live-source verdict |

## Test Audit

The current test suite is useful, but it does not prove release readiness:

- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves file-backed journal restart behavior, hash redaction, and classification of modeled failure states. It does not prove durable production storage, crash survival on the live source, or no-loss behavior under the real release boundary.
- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves the planner rejects conflicts and attaches live-remote preconditions. That is preflight evidence only; it does not prove the live mutation happened after the recheck, and it does not prove the remote/local topology is real rather than simulated.
- None of the current tests prove an apply-time live-source recheck on the real boundary. They can assert that a stale claim would be refused in the model, but they do not prove that the source was revalidated immediately before mutation on live storage.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) is strongest on refusal logic, not speed. It proves the benchmark can refuse unsupported production throughput and that tampering flips the claim blockers back on. It still reports `productionThroughput: 'not-claimed'`, so it is anti-claim evidence, not a live-path speed claim, and it does not itself emit the mandatory release verdict.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) exercises modelled batching, chunking, and failure injection boundaries. It is not a live benchmark and cannot justify production throughput language.
- [`test/playground-snapshot-lib.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/playground-snapshot-lib.test.js) constrains fixture topology and file-path safety. It helps prevent accidental overreach, but it still remains fixture-scoped.
- [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) confirms the operational gap: there is no required release command, only `test`, `plan`, `apply`, and optional playground or recovery helpers. Optional entrypoints can produce evidence, but they do not create a mandatory verdict.

Bottom line: the tests collectively prove the repo is refusal-capable and model-aware. They do not prove the objective's live-source no-loss, reliability, or speed claims, and they must not be read as release proof just because `node --test` passes.

Test verdict: `node --test` is necessary regression evidence, but it is not a release verdict. The suite can reject unsafe claims, yet it still leaves the live-source boundary, durable production storage, and mandatory throughput verdict unproven. A passing test run should therefore be treated as lab evidence unless and until a required release command composes the missing gates and prints the release decision itself.

The weakest claim is still speed. It is weaker than the others because the repo does not just lack a positive number; it lacks a mandatory release command that can emit a machine-checkable verdict. Until that exists, `speed unclaimed` is not a neutral absence of data. It is the only defensible release verdict, and it must remain an explicit output of a required command rather than a sentence hidden in audit prose. Any future throughput language should be treated as release-blocked unless it comes from that command and names the live-source boundary it measured. In practical terms, if the required gate cannot print a measured throughput threshold, it must print `speed unclaimed` and fail closed. If the command can only say the claim is blocked, that is still not release proof; the command must own the verdict, not defer it. Optional smokes, benchmark refusals, and docs-only notes do not satisfy this requirement. The current benchmark test remains useful because it preserves the blocker, but it is not yet the release decision itself. A passing `node --test` run or any green optional smoke should therefore be read as regression evidence only, never as a speed, reliability, or no-data-loss verdict.

The next weakest claim after speed is the live-source apply boundary itself. The existing planner and journal tests show that the repo can reason about stale claims and restart states, but they still do not prove the source is rechecked at apply time and then mutated on the real storage path in the same run. That missing proof matters because a stale preflight and a safe replay model are both compatible with a broken release path. A release-safe audit therefore has to keep the apply-time recheck separate from the generic crash/recovery language: if the source is not revalidated immediately before mutation, the repo still cannot claim no data loss or reliability at the live boundary, even if the rest of the guardrails are green.

## Actionable Next Step

Add a required release entrypoint that fails closed unless it can prove, in one run, the live-source boundary, durable recovery artifacts, leases/fencing, graph identity, plugin data-driver coverage, and a real topology with either:

1. a measured live-path throughput result plus an explicit release threshold, or
2. an intentional refusal to make any production speed claim.

If the repo cannot measure live-path throughput, the gate should say so, block release by default, and keep any production-facing speed language out of the release claim rather than silently passing on refusal-only benchmark evidence. A release gate that only replays fixture checks, optional smokes, or benchmark refusals is still not a release gate. The actionable next step for this branch is to keep the release copy and gate language explicit that throughput is unclaimed, not merely unmeasured, and to encode that rule in a required command such as `npm run verify:release`.

That command should do three things at once:

1. prove the live-source boundary or fail,
2. surface `speed unclaimed` or a measured throughput result, and
3. exit non-zero if the proof is still lab-backed, fixture-backed, or omitted, including when speed remains `not-claimed` and no live-path measurement exists.

Until that command exists, `speed unclaimed` is not a deferment; it is the current release verdict, and the suite remains insufficient for any no-loss or reliability claim at the live-source boundary. A default `npm test` pass should be treated as regression-only evidence until the mandatory release command exists and runs the live boundary. Any future speed claim should be blocked unless it comes from that required command, because a benchmark refusal without the release entrypoint is still only lab evidence.

## Audit Rule

Treat fixture tests, refusal tests, route-shape smokes, benchmark models, and `labBacked: true` labels as useful but insufficient. They do not count as release proof unless they exercise the same live-source boundary named by the objective.

## Actionable Gap

The current weak point is not another missing assertion inside the existing suite. It is the absence of one mandatory release command that can fail closed in the same run on all of these conditions:

1. live-source apply-time recheck not proven
2. auth/session, durable journal, leases/fencing, graph identity, or plugin-data-driver missing
3. real remote/local topology not exercised
4. `productionThroughput` still `not-claimed` without an explicit `speed unclaimed` verdict, which means the release command must fail closed instead of silently passing

Until that command exists, the repo has a blocker, not a release path. The next audit step should be to keep the verdict terse and binary: either a measured live-path threshold, or an explicit `speed unclaimed` refusal, in a command that is mandatory for release.

Until that command exists, the repo has blocker evidence only. It does not have release proof, and no passing `node --test` or optional smoke can be promoted into one because the live-source verdict itself is still missing. Optional smokes and refusal-only benchmarks can strengthen the audit, but they cannot substitute for the required live-source release gate.
