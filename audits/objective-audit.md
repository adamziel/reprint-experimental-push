# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The current blocker is now precise: this checkout still lacks checked, production-boundary proof that auth/session lifecycle and durable journal semantics survive the live apply path. The old "no release command exists" framing is stale. `origin/lane/reliable-executor` now exposes `verify:release` at `2ac32891`, and the remote evidence that led there adds the explicit boundary verdict `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`; `scripts/playground/production-shaped-release-verify.mjs` reports the release bridge assertions for live preflight `200`, dry-run `200`, apply `200`, recovery inspect `200`, and journal readback `rows: 17`. The remote tip also adds `test:playground:production-shaped-missing-secret`, which is additional upstream gate evidence, but it still does not close the live production boundary in this checkout. That remote evidence is real and useful, but it remains upstream-only until this checkout owns an equivalent enforced verdict in its own release path. The release gate is therefore closed because the live production boundary is not yet proven here in-tree, and the remote wrapper alone does not change this checkout's release status. Graph identity, plugin-driver coverage, leases/fencing, preserved-remote drift, and live-source topology remain additional gaps, but they stay secondary to the missing auth/session plus durable journal verdict.

The gate stays closed until one required invocation proves, in the same run:

- retained-source live preflight
- apply-time revalidation before mutation
- dry-run receipt and apply result
- recovery/journal readback after the apply boundary
- production auth/session lifecycle
- durable journal semantics
- graph identity mapping
- plugin-driver coverage
- CI or default-entrypoint enforcement

## Explicit Requirements

The objective implies these minimum release requirements:

1. One-way pull base, then one-way push back to the live source. The direction matters; bidirectional lab sync is not the objective.
2. Apply-time revalidation against the live source before mutating it. A stale preflight is not enough.
3. End-to-end preservation of touched WordPress data shapes, including rows, files, plugin-owned data, serialized payloads, and graph identity.
4. Survival of crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes.
5. Production auth/session lifecycle and durable journal semantics proven at the release boundary, not only in helpers or optional smokes. Leases/fencing, graph identity, plugin-driver behavior, preserved-remote drift, and real topology also need release-boundary proof, but they remain secondary to the missing auth/session plus journal verdict.
6. Real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or storage abstraction.
7. Either a measured live-path speed claim with an explicit threshold or an explicit refusal to claim speed.
8. One required release command that fails closed when any safety gate is still lab-backed, fixture-only, benchmark-only, or missing live-source proof.
9. CI or another enforced default entrypoint that runs that gate.

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
| Apply-time revalidation | Benchmark model and lab smokes encode revalidation logic | A checked run that revalidates the real source immediately before mutation | Preflight-only evidence is not enough |
| No data loss | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) prove ordering, restart classification, redaction, and journal integrity in local files; [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves durable evidence for staged benchmark flows | End-to-end mutation on production storage across all touched WordPress data shapes, including the live apply boundary and crash/retry recovery on real storage | Local ordering is not a no-loss proof for live WordPress state |
| Reliability | Fixture refusal, journal guardrails, and lab smokes prove negative cases and restart classifications | One enforced release gate that composes production auth/session lifecycle, durable journal semantics, leases/fencing, graph identity, plugin-driver checks, and preserved-remote drift on the live boundary | Production reliability is still unproven where the release decision matters |
| Speed | [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) keeps `productionThroughput` unclaimed; [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) refuses unsupported throughput claims | A measured live-path throughput result or an enforced `speed unclaimed` verdict from a required release gate that runs on the live push path | There is no live-path speed proof, only modeled or benchmark-local behavior |
| Production auth/session lifecycle | [`test:playground:authenticated-http-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) and [`test:playground:production-shaped-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) show authenticated lab and production-shaped routes; `origin/lane/reliable-executor` exposes `verify:release`, and the remote evidence adds the boundary verdict `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` alongside live preflight `200` | A checked release command in this checkout that proves auth/session lifecycle at apply time against the retained live source endpoint | The current proof is split between lab routes, upstream verifier output, and release-shaped boundary evidence; it does not yet certify production session behavior at apply time here |
| Durable journal semantics | [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), [`test:playground:db-journal-idempotency`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and [`test:playground:db-journal-process-kill`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) prove local and Playground journal integrity; `origin/lane/reliable-executor` reports recovery inspect, journal readback, and the same `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` boundary verdict, with passing output that includes `rows: 17` | A checked release command in this checkout that proves durable apply/recovery journal behavior on production storage | Journal proof is split across helpers, fixtures, and upstream reporting, so it does not yet prove durable apply/recovery behavior on production storage here |
| Graph identity mapping | [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) encodes graph identity expectations | Production push-path graph identity proof on the retained source endpoint in this checkout | Identity is still modeled, not shipped |
| Plugin-driver coverage | [`test:playground:production-plugin-package`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:plugin-atomic-install`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and route smokes cover helper/plugin install flows | End-to-end plugin-driver behavior in a required release gate in this checkout | Plugin proof is still helper-scoped |
| Required release gate | `origin/lane/reliable-executor` at `2ac32891` exposes `verify:release` and `test:playground:production-shaped-missing-secret`; the remote evidence also adds the explicit verdict `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`, and its release verifier reports live preflight, dry-run, apply, recovery inspect, and journal readback | A checked run in this checkout or an enforced default entrypoint that completes the real live boundary and proves auth/session lifecycle plus durable journal semantics | The gate shape and a sharper upstream boundary verdict exist, but this checkout still lacks the live-boundary verdict where release safety matters |
| CI/default enforcement | None | A checked-in workflow or default entrypoint that runs the gate | Green default runs can still bypass release proof |
| Preserved remote drift / real topology | Helper smokes and fixtures model it indirectly; upstream claims mention a live drift witness | A checked command that proves the retained source remains live across preflight and apply in the same invocation on the release boundary | Drift witness coverage is stronger, but it still does not prove the production auth/session plus journal boundary |

## Test Audit

The tests do the right kind of negative work, but they are not positive release proof.

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves directionality, stale-plan refusal, remote-precondition checking, plugin-owner blocking, and local mutation ordering against in-memory/local fixtures. It does not prove lossless mutation on live WordPress storage, so it cannot certify no data loss.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves local JSONL journal integrity, redaction, restart classification, and recovery inspection. It does not prove crash durability on production storage, fsync/lock semantics, or recovery across the live apply boundary, so it cannot certify reliability.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves the benchmark model carries safety gates and refuses to claim production throughput. It does not measure the live push path, and it is not a performance result, so it cannot support a speed claim.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the guarded benchmark can move staged buffers and row payloads through durable evidence while refusing unsupported throughput claims. It does not prove the live push path is fast or release-ready, so it also cannot support a speed claim.
- [`test:playground:authenticated-http-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:production-shaped-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:production-plugin-package`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and the DB journal smokes prove helper- and lab-scoped behavior, including authenticated and production-shaped routes. They are not live-source evidence for the apply boundary. Upstream release-verifier claims add stronger live drift, dry-run, apply, recovery inspect, and journal readback evidence, but they still do not convert this checkout into a production boundary verdict.
- `node --test test/push-planner.test.js test/recovery-journal.test.js test/performance-model.test.js test/guarded-executor-benchmark.test.js` was rechecked in this worktree on 2026-05-25 and passed `86/86`. That is regression evidence only. It does not certify no data loss, reliability, or speed on the live source boundary.
- `origin/lane/reliable-executor` at `2ac32891` exposes `verify:release` and `test:playground:production-shaped-missing-secret`, and is the current remote proof that the release wrapper and the missing-secret gate exist upstream. That command exists upstream, but the proof is still remote-lane evidence and still not enough by itself, because this checkout does not yet own an equivalent live-boundary verdict.
- The strongest live-boundary claims still missing are not hypothetical. They are the production auth/session lifecycle, durable journal semantics, graph identity mapping, plugin-driver behavior, leases/fencing, and preserved-remote drift at apply time. The blocking issue is the incomplete production-boundary verdict, not the mere existence of a wrapper command.

## Current Command Surface

Direct command-surface recheck on 2026-05-25:

- [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still exposes `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers.
- This checkout still does not expose `verify:release` in its own `package.json`; that command only exists on `origin/lane/reliable-executor` at `2ac32891`.
- `origin/lane/reliable-executor` at [`2ac32891`](https://github.com/adamziel/reprint-experimental-push/commit/2ac32891) does expose `verify:release` and `test:playground:production-shaped-missing-secret`, and still maps the release verifier to `test:playground:production-shaped-release-verify`, so command absence is no longer the right blocker to cite.
- The preceding remote tips at [`889bd37a`](https://github.com/adamziel/reprint-experimental-push/commit/889bd37a) and [`9975dfc9`](https://github.com/adamziel/reprint-experimental-push/commit/9975dfc9) sharpen the remaining production boundary with the explicit verdict `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`.
- This checkout does not carry that release gate in-tree. That removes the old command-absence objection from the blocker list, but the primary release blocker remains the missing production-boundary proof for auth/session lifecycle plus durable journal semantics.
- Upstream release-verifier claims move the discussion from command absence to the remaining production boundary: auth/session lifecycle plus durable journal semantics, with graph identity, plugin-driver behavior, leases/fencing, preserved-remote drift, and topology still needing release-boundary proof. Reported passing output there includes live preflight `200`, dry-run `200`, apply `200`, recovery inspect `200`, and journal readback `rows: 17`, but that remains upstream evidence until this checkout owns the same verdict.
- This worktree rechecked the local regression slice on 2026-05-25 and it passed `86/86`; that is useful regression evidence, but it still does not prove the live boundary.
- There is no checked-in `.github` tree or workflow entrypoint in this checkout.
- The strongest current scripts remain support evidence, not a release gate, because none of them own the live-source verdict in the same invocation. The current regression suite rechecked in this worktree is green at `89/89`, and the targeted planner/recovery/benchmark slice rechecked on 2026-05-25 is green at `86/86`, but both remain regression-only evidence rather than a live-boundary release verdict.

## Release Gate Definition

The weakest current claim is not merely that the suite is incomplete. It is that the repository still lacks live-boundary proof for the remaining production claims, and therefore no green run can be promoted to release proof by interpretation alone, even if a release wrapper exists on `origin/lane/reliable-executor` and reports passing live preflight, dry-run, apply, recovery inspect, and journal readback.

Minimum properties of that gate:

1. It must run on the real release boundary, not just on fixtures or Playground storage.
2. It must revalidate apply-time live state before mutation.
3. It must fail closed if production auth/session lifecycle, durable journal semantics, leases/fencing, graph identity, plugin-driver, or topology proof is still lab-backed.
4. It must print a machine-checkable verdict for speed, including an explicit `speed unclaimed` refusal when no live-path measurement exists.
5. It must be the command CI or another default entrypoint actually invokes.

Until that gate exists, the strongest evidence remains regression or lab evidence, not release evidence. The current blocker is the absence of checked live-boundary proof for production auth/session lifecycle and durable journal semantics in this checkout. Graph identity, plugin-driver behavior, leases/fencing, and preserved-remote drift are still only lab-backed, but they are secondary until the auth/session-plus-journal boundary is proven.

## Conclusion

The repository has good refusal, journaling, and benchmark-model evidence. It does not yet have live-boundary proof that production auth/session lifecycle and durable journal semantics hold at apply time, and graph identity, plugin-driver coverage, plus preserved-remote drift are still only lab-backed. There is also no in-tree checked release gate that owns the live-source verdict. The next required proof is a checked live-boundary run in this checkout, or an equivalent enforced entrypoint that produces the same verdict here. The actionable blocker is still the missing in-tree live-boundary proof, and it keeps the release gate closed.
