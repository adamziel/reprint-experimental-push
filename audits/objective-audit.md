# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

The release gate stays closed for two precise reasons: this checkout still does not own a checked, in-tree production-boundary verdict for auth/session lifecycle and it still does not own a checked, in-tree verdict for durable journal semantics at the live apply boundary. The current upstream release verifier on `origin/lane/reliable-executor` (`91ef2b06`) fails closed with `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` when the live source or secrets are missing, and its companion boundary proof names durable journal storage as a separate remaining requirement. The upstream verifier also reports live preflight `200`, dry-run `200`, apply `200`, recovery inspect `200`, and durable journal readback with `rows: 17`, but that evidence is upstream-only until this checkout has an equivalent enforced command or default entrypoint.

Graph identity, plugin-driver coverage, leases/fencing, preserved-remote drift, and real topology still need production-boundary proof too, but they are secondary to the missing auth/session plus durable journal verdict.

## Explicit Requirements

The objective implies these minimum release requirements:

1. One-way pull from the base, then one-way push back to the live source. The direction matters.
2. Apply-time revalidation against the live source before mutation.
3. No data loss across rows, files, plugin-owned data, serialized payloads, and graph identity.
4. Crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart must not drop, duplicate, or reorder writes.
5. Production auth/session lifecycle and durable journal semantics must be proven at the release boundary, not only in helper tests or Playground smokes.
6. Graph identity, plugin-driver behavior, leases/fencing, preserved-remote drift, and real topology must also be proven at the release boundary.
7. Either a measured live-path speed claim with an explicit threshold or an explicit refusal to claim speed.
8. One required release command must fail closed when any safety gate is still lab-backed, fixture-only, or missing live-source proof.
9. CI or another default entrypoint must run that gate.

## Evidence Table

Evidence buckets:

- `Executable proof`: a checked command reaches the live-source boundary and can fail the release in this checkout.
- `Lab / fixture proof`: real execution, but still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof`: prose or audit statements with no executable boundary.
- `Missing proof`: no current evidence for the requirement at the release boundary.
- `Release blocker`: why the requirement still prevents a production claim.

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| One-way pull base then one-way push to live source | Local planner and apply tests model the direction correctly; upstream release verifier reaches live preflight and apply | A checked command in this checkout that proves the push back to the retained live source | No in-tree live-source apply verdict |
| Apply-time revalidation | Planner tests require live-remote preconditions before mutation | A checked live-boundary run that revalidates immediately before mutation | Preflight-only or fixture-only revalidation is insufficient |
| No data loss | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) prove local ordering, restart classification, redaction, and journal integrity; [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves staged evidence behavior | End-to-end mutation on production storage across touched WordPress data shapes, including live apply and recovery on real storage | Local ordering is not a no-loss proof for live WordPress state |
| Reliability | Local tests prove refusal paths, journal guardrails, and restart classification; upstream verifier reports live preflight/dry-run/apply/recovery/journal checks | One enforced release gate that composes auth/session lifecycle, durable journal semantics, leases/fencing, graph identity, plugin-driver checks, and preserved-remote drift on the live boundary | Production reliability is still unproven where the release decision matters |
| Speed | [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) refuses to claim production throughput; [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) blocks unsupported throughput claims | A measured live-path throughput result or an enforced `speed unclaimed` verdict from the live release gate | There is no live-path speed proof |
| Production auth/session lifecycle | `test:playground:authenticated-http-push` and `test:playground:production-shaped-push` cover authenticated and production-shaped lab routes; upstream release verifier now reports `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` | A checked release command in this checkout that proves auth/session lifecycle at apply time against the retained live source endpoint | Lab-only auth/session evidence does not certify the production boundary here |
| Durable journal semantics | [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js), `test:playground:db-journal-idempotency`, `test:playground:db-journal-process-kill`, and upstream release verifier output show durable-journal behavior in local or Playground scope; the upstream boundary proof separately names `PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED` | Production journal storage, lease, fencing, and recovery proof at the live apply boundary | Lab durability is not production durability |
| Graph identity | [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves stable remote identity in a benchmark model | A checked live-boundary verdict that identity mapping survives the real push path | Graph identity remains lab-backed |
| Plugin-driver behavior | [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) models plugin install batching and atomic groups | Production plugin-driver behavior on the live apply path | Plugin behavior is still modeled, not proven at release boundary |
| Real topology and preserved-remote drift | Upstream verifier starts retained-source Playground sites and reports live drift evidence between base and changed fixtures | A checked in-tree command that proves the same preserved-remote behavior on the live source boundary | Topology and drift proof remain upstream-only |
| CI or default enforcement | `package.json` exposes `verify:release` upstream, but this checkout still lacks an in-tree enforced release entrypoint | A checked default entrypoint in this checkout that owns the release verdict | No enforced in-tree gate yet |

## Test Audit

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves planner behavior, live-remote precondition tracking, conflict refusal, atomic group handling, and plugin-owned resource policy in local fixtures. It does not prove no data loss on production storage or release-time auth/session behavior.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves JSONL monotonicity, redaction, restart classification, and drift detection in temporary files. It does not prove durable journal semantics on production storage or fence against real live-boundary failures.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) is explicit about refusing unsupported throughput claims. It is not a live-path speed measurement.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the benchmark model moves staged buffers and row payloads through durable evidence and blocks unsupported production throughput claims. It still does not measure the real push path, so it cannot support a speed claim.
- The local regression slice rechecked in this worktree passed `86/86`. That is useful regression evidence, but it is still not live-boundary proof of no data loss, reliability, or speed.
- The upstream release verifier is stronger than the local regression slice because it checks live preflight, dry-run, apply, recovery inspect, and journal readback. Even so, it remains upstream evidence until this checkout owns the same verdict in-tree.

## Current Command Surface

Direct command-surface recheck on `origin/lane/reliable-executor` at `91ef2b06`:

- `origin/lane/reliable-executor` at `91ef2b06` exposes `verify:release`, `test:playground:production-shaped-release-verify`, `test:playground:production-shaped-live-preflight`, `test:playground:production-shaped-missing-live-source`, and `test:playground:production-shaped-missing-secret`.
- `verify:release` maps to `test:playground:production-shaped-release-verify` on that upstream tip.
- `scripts/playground/production-shaped-release-verify.mjs` fails closed when no live source or no secret is provided, and it emits the remaining boundary verdict `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` plus the durable-journal blocker `PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED`.
- The same script reports live preflight `200`, dry-run `200`, apply `200`, recovery inspect `200`, and durable journal readback `rows: 17` when the release path succeeds.
- This checkout does not yet carry that checked verdict in-tree, so the release gate is still closed here.

## Release Gate Definition

The weakest current claim is not simply that the suite is incomplete. It is that this checkout still lacks an in-tree live-boundary verdict for the remaining production claims, so green regression runs cannot be promoted to release proof by interpretation alone.

Minimum properties of the gate:

1. It must run on the real release boundary, not only on fixtures or Playground storage.
2. It must revalidate apply-time live state before mutation.
3. It must fail closed if auth/session lifecycle, durable journal semantics, leases/fencing, graph identity, plugin-driver behavior, or topology proof is still lab-backed.
4. It must print a machine-checkable verdict for speed, including an explicit `speed unclaimed` refusal when no live-path measurement exists.
5. It must be the command CI or another default entrypoint actually invokes.

## Conclusion

The repository has strong local regression, refusal, and journaling evidence. It does not yet have in-tree live-boundary proof that production auth/session lifecycle and durable journal semantics hold at apply time, and the remaining graph identity, plugin-driver, lease/fencing, preserved-remote drift, and topology claims are still only lab-backed or upstream-only. The release gate stays closed until this checkout owns a checked live-boundary verdict or an enforced default entrypoint that produces the same verdict here.
