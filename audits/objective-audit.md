# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

Current top blocker, rechecked on 2026-05-25: the live release boundary is still not proven. The repo has green regression and lab evidence, plus helper and Playground scripts, but no checked run yet proves production auth/session lifecycle and durable journal semantics on the real push path in one fail-closed invocation. Graph identity mapping and plugin-driver coverage are still only lab-shaped. The precise blocker is the lack of live-boundary evidence for those remaining production claims, not helper availability or release-shaped wrappers. The release gate must stay closed until that evidence exists in a checked-in, enforced entrypoint.

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

If any of those remain only lab-backed, fixture-backed, or docs-backed, the release claim is still blocked.

## Explicit Requirements

The objective implies these minimum release requirements:

1. Start from a one-way pull base, then perform a one-way push back to the live source. The objective is directional, not bidirectional.
2. Revalidate the live source at apply time before mutating it. A stale preflight is not enough.
3. Preserve all touched WordPress data shapes end to end, including rows, files, plugin-owned data, serialized payloads, and graph identity.
4. Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart cases without dropping, duplicating, or reordering writes.
5. Prove production auth/session lifecycle and durable journal semantics at the release boundary, not only in helper scripts or optional smokes. Leases/fencing, graph identity, and plugin-driver behavior also need release-boundary proof, but they are still only lab-backed here. If any of these remain helper-scoped, the release claim is blocked.
6. Prove the real remote/local topology, not just a local Playground route, fixture mount, hostname alias, or storage abstraction that can satisfy tests without touching live source storage.
7. Either publish a measured speed claim from the live push path with an explicit threshold or explicitly refuse to make one.
8. Expose one required release command that fails closed when any safety gate is still lab-backed, fixture-only, benchmark-only, or missing live-source proof. Optional helpers are not enough.
9. Wire that release command into CI or another enforced default entrypoint so a green run cannot bypass the safety matrix.

## Evidence Table

Evidence buckets used below:

- `Executable proof` means a required command reaches the live-source boundary and can fail the release.
- `Lab / fixture proof` means the evidence is real code execution, but it is still scoped to local fixtures, Playground, or model-only storage.
- `Docs-only proof` means prose, labels, or audit statements with no executable boundary.
- `Missing proof` means the repo has no current evidence for the requirement at the release boundary.
- `Release blocker` states why the requirement still prevents a production claim.

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| One-way pull base then one-way push to live source | Planner and helper tests show directional intent in fixture scope | A required command that reaches the live source and performs the push back to the retained endpoint | No live-source apply verdict |
| Apply-time revalidation | Benchmark model encodes `apply-revalidates-live-resource-hash`; lab smokes exercise revalidation logic | A required run that revalidates the real source immediately before mutation | Preflight-only evidence is not enough |
| No data loss | [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) and [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) prove ordering, restart classification, and redaction in local files | End-to-end mutation on production storage across all touched WordPress data shapes | No mandatory durability verdict on the live boundary |
| Reliability | Fixture refusal, journal guardrails, and lab smokes prove negative cases | One enforced release gate that composes auth/session, durable journal, leases/fencing, graph identity, and plugin-driver checks | No live-boundary release verdict for the remaining production claims |
| Speed | [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) and [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) keep `productionThroughput` unclaimed | A measured live-path throughput result or an enforced `speed unclaimed` verdict from a required release gate | No live-path measurement |
| Production auth/session lifecycle | [`test:playground:authenticated-http-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) and [`test:playground:production-shaped-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) prove authenticated lab routes | Live-boundary auth/session lifecycle in the required release command | Release path still lacks production auth proof |
| Durable journal semantics | [`test:playground:db-journal-idempotency`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:db-journal-process-kill`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and [`test:recovery:file-journal`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) prove local and Playground journal integrity | Live-source journal durability that survives the apply boundary | Journal proof is split across helpers and fixtures |
| Graph identity mapping | Guarded benchmark encodes graph identity expectations | Production push-path graph identity proof on the retained source endpoint | Identity is still modeled, not shipped |
| Plugin-driver coverage | [`test:playground:production-plugin-package`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:plugin-atomic-install`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and route smokes cover helper/plugin install flows | End-to-end plugin-driver behavior in the required release gate | Plugin proof is still helper-scoped |
| CI/default enforcement | None | A checked-in workflow or default entrypoint that runs the gate | Green default runs can still bypass release proof |

## Test Audit

The tests do the right kind of negative work, but they are not positive release proof.

- [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/push-planner.test.js) proves directionality, stale-plan refusal, and local mutation ordering against in-memory/local fixtures. It does not prove lossless mutation on live WordPress storage.
- [`test/recovery-journal.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/recovery-journal.test.js) proves local JSONL journal integrity, redaction, restart classification, and recovery inspection. It does not prove crash durability on production storage or recovery across the live apply boundary.
- [`test/performance-model.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/performance-model.test.js) proves the benchmark model carries safety gates and refuses to claim production throughput. It does not measure the live push path, and it is not a performance result.
- [`test/guarded-executor-benchmark.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/test/guarded-executor-benchmark.test.js) proves the guarded benchmark can move staged buffers and row payloads through durable evidence while refusing unsupported throughput claims. It does not prove the live push path is fast or release-ready.
- [`test:playground:authenticated-http-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:production-shaped-push`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), [`test:playground:production-plugin-package`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json), and the DB journal smokes prove helper- and lab-scoped behavior, including authenticated and production-shaped routes. They still do not prove the live-source boundary or production storage durability.
- `npm test -- --test-reporter=spec` was rechecked in this worktree and passed at `89/89`. That is regression evidence only. It does not certify no data loss, reliability, or speed on the live source boundary.

## Current Command Surface

Direct command-surface recheck on 2026-05-25:

- [`package.json`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/independent-auditor/package.json) still exposes `test`, `plan`, `apply`, `test:recovery:file-journal`, and optional `test:playground:*` helpers.
- This checkout does not expose a checked-in `verify`, `verify:release`, or `release` script.
- A history check shows commit `3089aee2` documenting a `verify:release` alias, but that alias is not present in this worktree, so the visible release surface here is still absent.
- There is no checked-in `test:playground:production-shaped-release-proof` entry here, and the existing `production-shaped` helper remains a lab-shaped route smoke rather than a release gate.
- There is no checked-in `.github` tree or workflow entrypoint in this checkout.
- The strongest current scripts remain support evidence, not a release gate, because none of them own the live-source verdict in the same invocation.

## Release Gate Definition

The weakest current claim is not merely that the suite is incomplete. It is that the repository still lacks live-boundary proof for the remaining production claims, and therefore no green run can be promoted to release proof by interpretation alone.

Minimum properties of that gate:

1. it must run on the real release boundary, not just on fixtures or Playground storage
2. it must revalidate apply-time live state before mutation
3. it must fail closed if auth/session, journal durability, leases/fencing, graph identity, plugin-driver, or topology proof is still lab-backed
4. it must print a machine-checkable verdict for speed, including an explicit `speed unclaimed` refusal when no live-path measurement exists
5. it must be the command CI or another default entrypoint actually invokes

Until that gate exists, the strongest evidence remains regression or lab evidence, not release evidence.

## Conclusion

The repository has good refusal, journaling, and benchmark-model evidence. It does not yet have a checked-in live-source release gate that proves production auth/session lifecycle, durable journal semantics, graph identity, and plugin-driver coverage at apply time. That is the actionable blocker, and it keeps the release gate closed.
