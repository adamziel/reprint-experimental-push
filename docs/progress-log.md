# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-24 - Baseline Evidence Pass

- `npm test` passed with 9 Node test scenarios covering the deterministic JSON
  snapshot planner and applicator. Evidence:
  [test/push-planner.test.js](../test/push-planner.test.js).
- The current planner implements three-way base/local/remote comparison,
  conflict stops, remote-only preservation, plugin-owned conflict
  classification, atomic intent dependency checks, and precondition hashes.
  Evidence: [src/planner.js](../src/planner.js).
- The current applicator validates preconditions, stages mutations before
  returning a changed snapshot, rejects non-ready plans, and includes an
  injected pre-commit failure path. Evidence: [src/apply.js](../src/apply.js).
- The page at [progress.html](../progress.html) reports this as a safety model,
  not a production WordPress transport.

## 2026-05-24 - Status By Area

| Area | Progress | Evidence | Still pending |
| --- | ---: | --- | --- |
| Merge invariants | 25% | 9 planner/apply tests; [scenario matrix](scenario-matrix.md) | Real WordPress resource fixtures, SQL/file semantics, live-site mutation checks |
| Recovery boundaries | 8% | In-memory staging and injected pre-commit failure test | Durable recovery journal, kill-process tests, old/new/blocked recovery proof |
| Reliable executor and protocol | 6% | JSON snapshot CLI and guarded apply contract | Reprint protocol extension, real WordPress executor, remote audit records |
| Fast path and chunking | 8% | Resource-level model avoids full-site replacement | File streaming, upload chunks, batching strategy, benchmark evidence |
| Independent evidence and critique | 15% | [source notes](source-notes.md), [approach scorecard](approach-scorecard.md), [scenario matrix](scenario-matrix.md) | External audit of live integration behavior |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress executor: pending until a source site is mutated through the
  intended protocol and verified after apply.
- Durable recovery journal: pending until journal files or equivalent recovery
  artifacts survive process failure and classify the target as old, new, or
  blocked.
- Docker or WordPress Playground integration: pending until base/local/remote
  sites run through an automated integration scenario.
- Plugin validators or drivers: pending until plugin-specific semantics are
  implemented and tested against real plugin-owned data.
