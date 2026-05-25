# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

Current top blocker, rechecked on 2026-05-25: the release boundary still lacks executable proof that production auth/session lifecycle and durable journal semantics are safe on the real push path. The blocker is no longer "there is no release command"; it is "there is no checked live-boundary verdict in this checkout that proves the production boundary." Graph identity mapping, plugin-driver coverage, leases/fencing, preserved-remote drift, and live-source topology remain additional release gaps, but they do not displace the main blocker. Upstream `verify:release`-style output is relevant evidence, and reported runs there include live preflight `200`, dry-run `200`, apply `200`, recovery inspect `200`, and journal readback `rows: 17`, but it remains upstream evidence until this checkout owns the same enforced verdict or an equivalent local gate. The absence of an in-tree `verify:release` script here is enforcement debt, not the decisive blocker.

The release gate therefore remains closed until there is executable proof for all of the following in the same required invocation:

- live-source preflight against a retained source endpoint
- apply-time revalidation before mutation
- dry-run receipt plus apply-time verification
- journal and recovery readback that survives the apply boundary
- production auth/session lifecycle
- durable journal semantics
- graph identity mapping
- plugin-driver coverage
- CI/default enforcement of the gate

The key point is that these are not separate lab facts. They need one mandatory, checked command that reaches the retained source, revalidates before apply, performs or refuses the live mutation, and emits a machine-checkable release verdict. Without that, helper success still cannot be promoted to release proof.

If any of those remain only lab-backed, fixture-backed, or docs-backed, the release claim is still blocked. The current repo state still leaves the gate closed because the required live-boundary proof does not exist here yet. Even if an upstream verifier now reports live preflight, dry-run, apply, recovery, and journal readback outputs, the remaining decisive gap is still the production auth/session lifecycle and durable journal semantics at the real release boundary. The next concrete acceptance test is a single checked command that reaches the retained source, revalidates immediately before apply, and emits a machine-checkable failure if those production-only claims are still only lab-backed.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not bidirectional.
2. Revalidate the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve all touched WordPress data shapes end to end, including rows, files, plugin-owned data, serialized payloads, and graph identity.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes.
5. Prove production auth/session lifecycle and durable journal semantics at the release boundary, not only in helper scripts or optional smokes. Leases/fencing, graph identity, plugin-driver behavior, and preserved-remote drift also need release-boundary proof. If any of these remain helper-scoped, the release claim is blocked, but they are secondary to the auth/session plus journal boundary.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or storage abstraction that can satisfy tests without touching live source storage.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one. Benchmarks alone are not enough to convert a lab path into a release claim.
8. Expose one required release command that fails closed when any safety gate is still lab-backed, fixture-only, benchmark-only, or missing live-source proof. Optional helpers are not enough, and the command must own the live-boundary verdict rather than merely wrapping helper checks. The remaining production-only verdict still has to be proven at auth/session and durable-journal scope before the release claim can move.
9. Wire that release command into CI or another enforced default entrypoint so a green run cannot bypass the safety matrix.

## Evidence Table

Evidence buckets used below:

- `Executable proof` means a required command reaches the live-source boundary and can fail the release in this checkout.
- `Lab / fixture proof` means the evidence is real code execution, but it is still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof` means prose, labels, or audit statements with no executable boundary.
- `Missing proof` means the repo has no current evidence for the requirement at the release boundary.
- `Release blocker` states why the requirement still prevents a production claim.

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| One-way pull base then one-way push to live source | Planner and helper tests show directional intent in fixture scope | A checked command that reaches the live source and proves the push back to the retained endpoint | No live-source apply verdict |
| Apply-time revalidation | Benchmark model encodes `apply-revalidates-live-resource-hash`; lab smokes exercise revalidation logic | A checked run that revalidates the real source immediately before mutation | Preflight-only evidence is not enough |
| No data loss | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) prove ordering, restart classification, redaction, and journal integrity in local files; [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves durable evidence for staged benchmark flows | End-to-end mutation on production storage across all touched WordPress data shapes, including the live apply boundary and crash/retry recovery on real storage | Local ordering is not a no-loss proof for live WordPress state |
| Reliability | Fixture refusal, journal guardrails, and lab smokes prove negative cases and restart classifications | One enforced release gate that composes production auth/session lifecycle, durable journal semantics, leases/fencing, graph identity, plugin-driver checks, and preserved-remote drift on the live boundary | Production reliability is still unproven where the release decision matters |
| Speed | [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) keeps `productionThroughput` unclaimed; [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the benchmark gate refuses unsupported throughput claims | A measured live-path throughput result or an enforced `speed unclaimed` verdict from a required release gate that runs on the live push path | There is no live-path speed proof, only modeled or benchmark-local behavior |
| Production auth/session lifecycle | [`test:playground:authenticated-http-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) and [`test:playground:production-shaped-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) show authenticated lab and production-shaped routes; upstream `verify:release` reports a live preflight and apply flow | Live-boundary auth/session lifecycle in a checked release command on the retained source endpoint in this checkout | The current proof is still split between lab routes, upstream verifier output, and release-shaped boundary evidence; it does not yet certify production session behavior at apply time here |
| Durable journal semantics | [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test:playground:db-journal-idempotency`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and [`test:playground:db-journal-process-kill`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) prove local and Playground journal integrity; upstream `verify:release` reports recovery inspect and journal readback | Live-source journal durability that survives the apply boundary in this checkout | Journal proof is split across helpers, fixtures, and upstream reporting, so it does not yet prove durable apply/recovery behavior on production storage here |
| Graph identity mapping | [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) encodes graph identity expectations | Production push-path graph identity proof on the retained source endpoint in this checkout | Identity is still modeled, not shipped |
| Plugin-driver coverage | [`test:playground:production-plugin-package`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:plugin-atomic-install`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and route smokes cover helper/plugin install flows | End-to-end plugin-driver behavior in a required release gate in this checkout | Plugin proof is still helper-scoped |
| Required release gate | Helper and Playground scripts only in this checkout; upstream release-verifier claims exist and reportedly pass `npm run verify:release` with live preflight, dry-run, apply, recovery inspect, and journal readback | A checked run in this checkout or enforced default entrypoint that completes the real live boundary and proves auth/session lifecycle plus durable journal semantics | The gate shape is important, but the live-boundary verdict is still incomplete where release safety matters |
| CI/default enforcement | None | A checked-in workflow or default entrypoint that runs the gate | Green default runs can still bypass release proof |
| Preserved remote drift / real topology | Helper smokes and fixtures model it indirectly; upstream claims mention a live drift witness | A checked command that proves the retained source remains live across preflight and apply in the same invocation on the release boundary | Drift witness coverage is stronger, but it still does not prove the production auth/session plus journal boundary |

## Test Audit

The tests do the right kind of negative work, but they are not positive release proof.

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves directionality, stale-plan refusal, remote-precondition checking, plugin-owner blocking, and local mutation ordering against in-memory/local fixtures. It does not prove lossless mutation on live WordPress storage, so it cannot certify no data loss.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves local JSONL journal integrity, redaction, restart classification, and recovery inspection. It does not prove crash durability on production storage, fsync/lock semantics, or recovery across the live apply boundary, so it cannot certify reliability.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves the benchmark model carries safety gates and refuses to claim production throughput. It does not measure the live push path, and it is not a performance result, so it cannot support a speed claim.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the guarded benchmark can move staged buffers and row payloads through durable evidence while refusing unsupported throughput claims. It does not prove the live push path is fast or release-ready, so it also cannot support a speed claim.
- [`test:playground:authenticated-http-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:production-shaped-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:production-plugin-package`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and the DB journal smokes prove helper- and lab-scoped behavior, including authenticated and production-shaped routes. Upstream release-verifier claims add stronger live drift, dry-run, apply, recovery inspect, and journal readback evidence, but they still do not convert this checkout into a production boundary verdict.
- `node --test test/push-planner.test.js test/recovery-journal.test.js test/performance-model.test.js test/guarded-executor-benchmark.test.js` was rechecked in this worktree on 2026-05-25 and passed `86/86`. That is regression evidence only. It does not certify no data loss, reliability, or speed on the live source boundary.
- The strongest live-boundary claims still missing are not hypothetical. They are the production auth/session lifecycle, durable journal semantics, graph identity mapping, plugin-driver behavior, and preserved-remote drift at apply time. The blocking issue is the incomplete production-boundary verdict, not the mere existence of a wrapper command.

## Current Command Surface

Direct command-surface recheck on 2026-05-25:

- [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still exposes `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers.
- This checkout exposes helper and Playground scripts, but it does not carry a checked `verify:release` command surface in-tree. That is enforcement debt in this lane, not the root release blocker.
- Upstream release-verifier claims move the discussion from command absence to the remaining production boundary: auth/session lifecycle plus durable journal semantics, with graph identity, plugin-driver behavior, leases/fencing, preserved-remote drift, and topology still needing release-boundary proof. Reported passing output there includes live preflight `200`, dry-run `200`, apply `200`, recovery inspect `200`, and journal readback `rows: 17`, but that remains upstream evidence until this checkout owns the same verdict. In this checkout, the lack of an in-tree `verify:release` script is still separate enforcement debt.
- There is no checked-in `.github` tree or workflow entrypoint in this checkout.
- The strongest current scripts remain support evidence, not a release gate, because none of them own the live-source verdict in the same invocation. The current regression suite rechecked in this worktree is green at `89/89`, and the targeted planner/recovery/benchmark slice rechecked on 2026-05-25 is green at `86/86`, but both remain regression-only evidence rather than a live-boundary release verdict. That is enforcement debt in this checkout, not a substitute for production-boundary proof.

## Release Gate Definition

The weakest current claim is not merely that the suite is incomplete. It is that the repository still lacks live-boundary proof for the remaining production claims, and therefore no green run can be promoted to release proof by interpretation alone, even if a release wrapper exists upstream and reports passing live preflight, dry-run, apply, recovery inspect, and journal readback.

Minimum properties of that gate:

1. it must run on the real release boundary, not just on fixtures or Playground storage
2. it must revalidate apply-time live state before mutation
3. it must fail closed if production auth/session lifecycle, durable journal semantics, leases/fencing, graph identity, plugin-driver, or topology proof is still lab-backed
4. it must print a machine-checkable verdict for speed, including an explicit `speed unclaimed` refusal when no live-path measurement exists
5. it must be the command CI or another default entrypoint actually invokes

Until that gate exists, the strongest evidence remains regression or lab evidence, not release evidence. The current blocker is the absence of checked live-boundary proof for production auth/session lifecycle and durable journal semantics. Graph identity, plugin-driver behavior, leases/fencing, and preserved-remote drift are still only lab-backed, but they are secondary until the auth/session-plus-journal boundary is proven. The missing in-tree release gate is worth fixing, but it is not the decisive blocker; it is enforcement debt around a still-unproven live boundary.

## Conclusion

The repository has good refusal, journaling, and benchmark-model evidence. It does not yet have live-boundary proof that production auth/session lifecycle and durable journal semantics hold at apply time, and graph identity, plugin-driver coverage, plus preserved-remote drift are still only lab-backed. There is also no in-tree checked release gate that owns the live-source verdict. The actionable blocker is the live-boundary proof gap, and it keeps the release gate closed.
