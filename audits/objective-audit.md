# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The repo still lacks one enforced command that proves the one-way pull base plus one-way push back to the live source on the real storage and transport path. `node --test` currently passes 89 subtests, but every passing subtest remains fixture-, model-, or lab-backed. It proves local rejection and recovery classifications, not end-to-end no-loss behavior, crash recovery on live storage, or a live-path speed claim. The benchmark surface is even more explicit: it returns `productionThroughput: 'not-claimed'` and blocks production throughput claims. That is negative proof, not release proof. The release claim is still false until a required gate closes that gap, runs against the real live-source boundary, and is wired into a default entrypoint. Until that gate exists, `speed unclaimed` is the only defensible production-facing wording, and it should be treated as an explicit release verdict rather than a placeholder.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not a bidirectional sync.
2. Recheck the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve every WordPress data shape the push can touch, including rows, files, plugin-owned data, serialized payloads, and graph identity.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes at the live push boundary.
5. Enforce auth/session, durable journal, leases/fencing, storage, graph identity, and plugin-data-driver checks at the release boundary, not only in helper scripts or optional smokes.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or any storage abstraction that can satisfy the tests without touching live source storage.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one. Refusal-only benchmarks are not a speed claim, and release language must not drift into implied speed confidence without live-path measurement. If speed stays unclaimed, that should be a deliberate release decision, not an accidental omission, and the release command should fail closed unless it can print that refusal explicitly. Silence is not acceptable here; the gate must surface `speed unclaimed` or fail.
8. Expose one required release command that fails closed when any safety gate is still `labBacked: true`, fixture-only, benchmark-only, or missing live-source proof.
9. Wire that release command into CI or another enforced entrypoint so a green default run cannot bypass the safety matrix.
10. Make the release command print an explicit verdict for throughput. If the repo cannot measure live-path speed, the command must surface `speed unclaimed` and fail closed on any attempt to imply a production speed claim.
11. Keep optional smokes available for local evidence collection, but do not let them stand in for release proof.

## Requirement Map

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| One-way pull base, then one-way push to live source | Planner and smoke tests model the direction of the flow | No live-source apply path proves the direction on the production boundary | Directional intent is not enough until the live source is mutated in the same run |
| Live recheck at apply time | Planner tests require live remote preconditions | No production apply gate proves the recheck happens against the real source before mutation | A stale preflight can still pass unless the live boundary is enforced |
| WordPress shape coverage | Lab tests cover rows, files, plugin ownership, and graph identity modeling | No production-shaped gate proves every touched shape survives on live storage | Partial shape coverage is not a release claim |
| Crash/retry/replay safety | Recovery and journal tests cover restart classifications | No crash boundary proof on live storage, duplicate-request proof, or stale-lease proof | Restart classes in fixtures do not prove durability on the real source |
| Auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver | Optional smokes and benchmark fixtures cover pieces of the matrix | No single required command composes all of them at release time | Disconnected coverage cannot be promoted to a release gate |
| Real remote/local topology | Some smokes exercise lab routes and local aliases | No checked-in required gate proves a real remote/local topology instead of a lab-backed route | Lab topology can satisfy tests while the live source remains unproven |
| Speed claim or explicit refusal | Benchmark tests refuse unsupported throughput claims | No measured live-path speed result and no enforced `speed unclaimed` release command | Refusal-only evidence blocks overclaiming but does not release the speed claim |
| Required release entrypoint | None | No `verify`, `release`, or `verify:release` script in `package.json`; this checkout also has no `.github/workflows/` gate, and the benchmark surface still reports `productionThroughput: 'not-claimed'` | Green optional runs can bypass the release decision entirely, so the repo still has no mandatory place where the live-source verdict, `speed unclaimed` refusal, or measured throughput result must appear |

## Proof Boundary

Current proof must be judged against the live-source release boundary, not against the existence of local helper paths. The following are useful inputs, but they are not release proof on their own:

- planner refusal tests that only compare fixtures
- journal tests that only read and write local files
- benchmark tests that only model a speed claim or refuse an unsupported one
- route smokes that still report `labBacked: true`
- any proof that does not exercise the one-way pull base to one-way push to live source loop

The strongest current runnable evidence still falls into four classes:

- executable proof: none that reaches the live-source boundary
- lab / fixture proof: `npm test` and the fixture-backed or file-backed smokes
- docs-only proof: prose in `README.md`, `progress.html`, and the supervisor/audit notes
- missing proof: live-source apply-time mutation, durable crash survival on production storage, measured live-path throughput, and a required release gate

Only the first bucket would count as release proof, and it does not exist in this checkout. The current repository only has lab / fixture proof and docs-only proof, so it still falls short of the live-source release boundary. In other words, the suite can reject unsafe states, but it cannot certify a live push.

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

| Bucket | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| Executable proof | `node --test` currently passes 89 subtests. The strongest executable assertions live in [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js), [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js), and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js). | No executable test touches the live-source mutation boundary, exercises a real remote-to-local-to-remote release path, proves no data loss on production storage, proves crash recovery on the live boundary, or measures the live push path speed claim; the benchmark code path still reports `productionThroughput: 'not-claimed'` and rejects that claim by design. | Executable proof here is guardrail proof, not release proof. A green `node --test` run still leaves the live push unproven. |
| Lab / fixture proof | Optional smokes such as `npm run test:playground:http-push`, `npm run test:playground:authenticated-http-push`, `npm run test:playground:production-shaped-push`, and `npm run test:playground:db-journal-idempotency` exercise the lab route shape, auth/session scaffolding, storage guards, and journal replay states. The production-shaped route smoke still reports `labBacked: true`, so even its strongest branch is a labeled lab route rather than a live-source release proof. | These runs still self-identify as lab-backed and fixture-scoped. They do not prove the real remote/local topology, durable production storage, or the live push boundary named by the objective. | Lab success must stay below the release bar until it is joined by a required live-source gate. |
| Docs-only proof | `README.md`, `supervision/README.md`, and the audit notes describe the intended release flow and safety matrix. | Prose does not enforce the matrix or prove the live path. | Documentation is advisory only; it cannot clear the release gate. |
| Missing proof | No `verify`, `release`, or `verify:release` script in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json#L10-L33); no checked-in `.github` workflow in this checkout; no required command that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real topology, crash boundary, recovery, and a measured live-path speed check. | Indirect evidence is insufficient here: the repo still lacks the single mandatory decision point that could make the live-source claim releasable, so the current command set can still succeed without any proof that a live push is safe, lossless, durable, or fast enough, and no default script fails closed on those missing gates. Optional smokes can still pass while the release proof remains absent. This is not a missing-detail problem; it is a missing-release-gate problem. | The missing release command lets green lab runs bypass the live-source decision entirely, and it leaves `speed unclaimed` unenforced as an explicit outcome. |
| Release blockers | `labBacked: true`, fixture-only scope, benchmark-only evidence, missing live-source proof, and missing enforced gate. | None of these are acceptable as release proof. | The release claim stays blocked until live topology, durable recovery, and either a measured live-path speed claim or an explicit `speed unclaimed` refusal are all enforced in one gate. |

## Test Audit

The current tests are useful, but they are not proof of no data loss, reliability, or speed at the production boundary. They mostly prove that the lab harness is internally consistent and that unsafe claims are refused. That is necessary guardrail coverage, not release evidence. The suite still stops short of proving the live-source loop, so every positive interpretation must stay limited to lab scope. In particular, `npm test` proving 89 passing subtests is still compatible with a release that would lose data, fail under a crash, or miss a throughput threshold on the live boundary, because the suite never forces that boundary or a production storage backend. Passing tests here are best read as "the release should not be trusted yet", not as "the release is safe".

The strongest test files deserve a stricter reading:

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves planner invariants and refusal behavior for modeled inputs, not that a live source is mutated safely.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves local journal structure, restart classification, and redaction, not durable no-loss recovery on production storage.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves the model can describe and refuse throughput claims, not that the live path is fast enough.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves a benchmark claim stays blocked until missing production evidence exists, which is helpful anti-claim evidence but still not a speed result.

So the test suite currently proves three things and only three things at the release boundary:

1. unsafe claims can be refused,
2. lab and fixture states can be classified consistently, and
3. the audit can detect missing proof.

It does not prove no data loss, reliability, or speed on the real release path.

Release inference rule: if a test only shows fixture integrity, redaction, refusal, or lab replay, it can support a blocker note, but it cannot support `no data loss`, `reliable`, or `fast` at the live-source boundary.

| Test surface | What it proves | What it does not prove | Release value |
| --- | --- | --- | --- |
| [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and `npm test` | Planner refusal, remote-change protection, local deletion blocking, plugin-owned data blocking, and fixture-level conflict handling | No live-source mutation, no production storage boundary, no end-to-end no-loss proof, no real remote/local topology, and no evidence that production writes survive retries, crashes, stale claims, or duplicate apply attempts. These tests prove the planner can reject unsafe states, not that a release path can safely mutate production storage. | Blocker evidence only |
| [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) | File-backed journal monotonicity, redaction, restart classification, and blocked recovery states | No durable production journal, no lease/fencing regime, no real crash recovery on the source boundary, no duplicate/write-loss proof on live storage, and no evidence that a live apply is replay-safe under the production storage semantics named by the objective. The journal tests stop at local correctness and do not prove the journal can survive a live apply crash boundary. | Blocker evidence only |
| [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) | Benchmark shape, guardrails, refusal discipline, and safe-fast-path modeling | No measured throughput, no memory ceiling, no runtime threshold on a live push path, no production timing evidence, no proof that the speed story is anything more than a model or refusal gate. This suite is descriptive, not a live-path benchmark, so it cannot support a production speed claim or prove that the live path is fast enough. | Blocker evidence only |
| [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) | Explicit refusal of unsupported throughput claims and tamper detection for benchmark evidence | No positive speed claim, no production-shaped timing result, no live-path benchmark threshold, no real live-source throughput measurement, no proof that a production release is fast enough, and no enforced default entrypoint that turns the refusal into a release gate. It proves the claim is blocked, not that the block has been cleared, and it should stay that way until a measured live-path result exists. By itself, it cannot prove speed, reliability, or no data loss on the live boundary. | Blocker evidence only |
| `npm run test:playground:*` optional smokes, including `http-push` and `authenticated-http-push` | Lab/fixture route shape, auth/session scaffolding, storage guard behavior, stale-claim classification, and journal smoke paths | No real remote/local topology, no production storage path, no enforced release gate, and no release decision because the smokes remain optional; the client and route still label themselves `labBacked: true` | Lab evidence only |

These tests can justify a cautious lab narrative. They do not justify a release narrative for the one-way pull base plus one-way push back to the live source.

## Claim Audit

The user-facing claims fail for the same reason: the suite stops at guarded models and lab flows.

- `No data loss`: the recovery tests prove monotonic journals, redaction, and restart classification on fixture-backed storage, but they do not prove a live-source apply can survive a crash, retry, or duplicate replay without loss at the production storage boundary.
- `Reliable`: the tests prove refusal behavior, restart states, and local journal integrity, but they do not prove the one-way pull base plus one-way push back to live source is durable under the production storage semantics named by the objective, nor that stale claims and mid-apply restarts are safe on live storage.
- `Fast`: the benchmark suite is intentionally refusal-first. It can reject unsupported throughput claims, but it does not report a measured live-path throughput result or a release threshold for production speed. Until that changes, release-facing copy should not imply positive throughput.

The weakest claim remains speed, and it is currently weaker than the rest of the release story because the repo has no measured live-path number, no release threshold, and no enforced gate that fails closed on the missing measurement. That means even a perfect lab auth/journal story would still leave the production speed claim blocked. The audit should treat any future throughput language as release-blocked until it is tied to the live-source boundary, an explicit threshold, and a required command that fails when `productionThroughput` is still `not-claimed`. If the project intends to keep speed unclaimed, the audit should say that plainly rather than letting the absence of a number read like a deferred approval. The important distinction is that `speed unclaimed` is a release decision, while `speed not measured` would still be incomplete.

The current test suite proves negative claims better than positive release claims. It proves that unsupported throughput can be refused, but it does not prove a production throughput floor or a live-path SLO. That means the safest release-language reading is not "fast enough is likely", but "fastness is intentionally unclaimed until the required gate exists". Any softer reading would overstate what the tests actually cover.

That also means the release gate must be opinionated enough to reject a green run that never reaches the live-source verdict. A command that only replays fixture checks or optional smokes and then exits zero is not a release decision, even if it accurately refuses to claim throughput. The required gate has to surface one of two outcomes in the same run: a measured live-path throughput result, or an explicit `speed unclaimed` verdict that is part of the release decision itself.

The actionable rule is simple: add one default release command, wire it into CI, and make it print either a measured live-path throughput result or a deliberate `speed unclaimed` verdict. Anything softer than that still leaves the release language ambiguous, because optional smokes and refusal-only benchmarks can prove the project is cautious without proving the live push path is ready.

## Release Blockers

The objective stays blocked for five concrete reasons:

1. There is no single required release command in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real remote/local topology, crash boundary, recovery, and a measured live-path speed check.
2. The strongest authenticated push route still self-identifies as `labBacked: true` in [`src/authenticated-http-push-client.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/src/authenticated-http-push-client.js#L63-L73), and the route surface echoes that same label in [`scripts/playground/push-remote-rest-plugin.php`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/scripts/playground/push-remote-rest-plugin.php#L2702-L2713), so the best visible push evidence is still lab-scoped and cannot be treated as a production release proof.
3. The benchmark tests are refusal-only. They prove the suite can reject unsupported throughput claims, but they do not measure the live push path, publish a live-path threshold, or establish a production release speed claim. A refusal-only benchmark is anti-claim evidence, not speed proof, and should be treated as a guardrail until a measured live-path result exists. If the repo intends to keep speed unclaimed, that decision still needs a required command that says so explicitly, and release copy must say `speed unclaimed` rather than silently omitting the claim.
4. The current recovery and journal tests are fixture-backed. They prove local model behavior, not durable production storage on the live source boundary, and they do not exercise a real remote-to-local-to-remote release path or no-loss behavior under the production storage semantics named by the objective.
5. There is no checked-in CI workflow in this checkout and no `verify`/`release`/`verify:release` script in [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), so there is no visible enforced entrypoint that could make the required release gate mandatory or close the loop from proof to deployable gate. Optional smokes, including the `production-shaped` route path and `http-push`, can still be run directly, which means the repository can report local success without proving the live-source boundary or producing a release-grade speed measurement.
6. The benchmark suite is intentionally refusal-first: `report.throughput.productionThroughput` stays `not-claimed`, and the speed claim tests only prove the gate refuses unsupported production throughput until the missing measurements exist.
7. The tests that look strongest are still proving preconditions and refusal behavior, not end-to-end mutation safety under a crash boundary. That is useful, but it is not release evidence.
8. The current benchmark surfaces are explicitly refusal-oriented; they are acceptable as anti-claim evidence, but they still do not establish a live-path speed claim.
9. The lab route coverage is still self-described as `labBacked: true` on the strongest push paths, so even the authenticated success cases remain local proof, not production release proof.
10. No test or smoke in this checkout demonstrates the one-way pull base plus one-way push back to live source under the production storage semantics named by the objective.
11. The repository still has no measured live-path throughput result, so speed is blocked even if all of the lab safety claims remain green.

Those blockers are actionable, not abstract: the repo needs one mandatory command that reaches the live-source boundary, proves the release safety matrix in one run, and either prints a measured throughput result or explicitly prints `speed unclaimed` before it can be treated as releasable.

The weakest claim is speed, and the audit should keep treating it as blocked until there is a measured live-path number with a threshold. The practical consequence is simple: do not convert the current refusal-only benchmark into release language. If the repo cannot measure production throughput yet, the release gate should fail closed on that missing measurement instead of implying performance confidence from models or smokes. A refusal-only benchmark is useful because it prevents overclaiming, but it is not evidence that the live push path is fast enough. Release copy should therefore say `speed unclaimed` until the live-path benchmark exists and is wired into a required gate that exits non-zero when `productionThroughput` is still `not-claimed`. Treat any other phrasing as a release blocker, not a placeholder.

The repository still has only refusal-only throughput evidence, no measured live-path result, and no enforced threshold that would let the project say anything positive about production speed. Until that changes, the only defensible statement is that unsupported throughput claims are rejected. The release gate should therefore require a positive live-path measurement or fail the run, rather than allowing a green benchmark refusal to masquerade as performance proof. A passing refusal benchmark is acceptable only if the required gate also emits the explicit `speed unclaimed` decision.

Treat `speed unclaimed` as an explicit release verdict, not a soft omission. If the required command cannot print that verdict in the same run as the rest of the release checks, then the command has not actually made a production speed decision and should fail closed.

## Claim Status

| Claim | Current status | What would be needed to release it |
| --- | --- | --- |
| `No data loss` | Not proven at the live-source boundary | A required live-path gate that survives crash, retry, replay, duplicate claim, stale lease, and mid-apply restart on production storage |
| `Reliable` | Not proven at the live-source boundary | Enforced auth/session, durable journal, leases/fencing, graph identity, and plugin-driver checks in one default release command |
| `Fast` | Explicitly unclaimed | Either a measured live-path throughput threshold or an intentional, enforced `speed unclaimed` decision surfaced by the required release gate |

## Actionable Next Step

Add a required release entrypoint that fails closed unless it can prove, in one run, the live-source boundary, durable recovery artifacts, leases/fencing, graph identity, plugin data-driver coverage, and a real topology with either:

1. a measured live-path throughput result plus an explicit release threshold, or
2. an intentional refusal to make any production speed claim.

If the repo cannot measure live-path throughput, the gate should say so, block release by default, and keep any production-facing speed language out of the release claim rather than silently passing on refusal-only benchmark evidence. A release gate that only replays fixture checks, optional smokes, or benchmark refusals is still not a release gate. The actionable next step for this branch is to keep the release copy and gate language explicit that throughput is unclaimed, not merely unmeasured, and to encode that rule in a required command such as `npm run verify:release`. That command should exit non-zero unless it can surface the live-path measurement or the deliberate `speed unclaimed` verdict in the same run. Until that command exists, `speed unclaimed` is not a deferment; it is the current release verdict.

## Audit Rule

Treat fixture tests, refusal tests, route-shape smokes, benchmark models, and `labBacked: true` labels as useful but insufficient. They do not count as release proof unless they exercise the same live-source boundary named by the objective.
