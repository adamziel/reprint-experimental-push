# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-24 - Baseline Evidence Pass

- `npm test` passed with 25 Node test scenarios covering the deterministic JSON
  snapshot planner and applicator. Evidence:
  [test/push-planner.test.js](../test/push-planner.test.js) and
  [test/performance-model.test.js](../test/performance-model.test.js).
- The current planner implements three-way base/local/remote comparison,
  conflict stops, remote-only preservation, plugin-owned conflict
  classification, atomic intent dependency checks, and precondition hashes.
  Evidence: [src/planner.js](../src/planner.js).
- The current applicator validates preconditions, stages mutations, rejects
  non-ready plans, and returns journal/recovery evidence for old remote, fully
  updated remote, and blocked recovery cases. Evidence:
  [src/apply.js](../src/apply.js) and
  [docs/recovery/apply-journal.md](recovery/apply-journal.md).
- `scripts/playground/smoke-blueprints.sh` passed with three no-server
  WordPress Playground blueprints for remote base, local edited, and remote
  changed fixture states. Evidence:
  [docs/playground-topology.md](playground-topology.md).
- `npm run test:playground` passed. It mounts this repository into three
  Playground runtimes, exports real WordPress posts/options/files with
  [scripts/playground/export-site-snapshot.php](../scripts/playground/export-site-snapshot.php),
  and asserts the planner sees the expected row, file, and plugin-data
  conflicts plus local-only mutations and remote-only preservation.
- Protocol, executor, fast-path, objective-audit, and critic documents have
  landed from supervised lanes. Evidence: [docs/protocol.md](protocol.md),
  [docs/executor.md](executor.md), [docs/fast-paths.md](fast-paths.md),
  [audits/objective-audit.md](../audits/objective-audit.md), and
  [audits/critic.md](../audits/critic.md).
- The page at [progress.html](../progress.html) reports this as a safety model,
  not a production WordPress transport.

## 2026-05-24 - Playground Guarded Apply Target

- `npm run test:playground` passed as a two-leg Playground harness: first it
  exported real WordPress Playground snapshots and asserted conflict planning,
  then it created a separate ready plan with `remote=base`, applied it inside a
  fresh Playground source site, and verified WordPress-visible posts, options,
  and files after the apply.
- The apply leg reported `status: ready`, `applied: 5`, verified the shared and
  local-only upload files, the plugin-owned option, the edited shared post, and
  the local-only post, then read back a `remote-base` Playground snapshot with
  two posts, one option, and two files.
- This target remains lab-scoped. It does not claim production Reprint HTTP
  source mutation support; the real HTTP transport/source mutation endpoint is
  still a pending proof gate.

## 2026-05-24 - Status By Area

| Area | Progress | Evidence | Still pending |
| --- | ---: | --- | --- |
| Merge invariants | 32% | Planner/apply tests; [scenario matrix](scenario-matrix.md); Playground snapshot planner/apply harness in [playground topology](playground-topology.md) | SQL/file mutation semantics beyond the fixture harness, live-site mutation checks |
| Recovery boundaries | 14% | Journal/recovery artifacts in [src/apply.js](../src/apply.js) and tests | Durable on-disk journal, process-kill tests, storage-level recovery proof |
| Reliable executor and protocol | 14% | [protocol](protocol.md), [executor](executor.md), protocol fixtures, Playground snapshot extraction, and guarded Playground apply | Implemented Reprint protocol extension, real WordPress mutation executor, remote audit records |
| Fast path and chunking | 12% | [fast paths](fast-paths.md) and [performance model tests](../test/performance-model.test.js) | Real transfer benchmarks, streaming implementation, large-site runtime evidence |
| Independent evidence and critique | 25% | [objective audit](../audits/objective-audit.md), [critic audit](../audits/critic.md), [source notes](source-notes.md) | External audit of live integration behavior |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress executor: pending until a source site is mutated through the
  intended protocol and verified after apply.
- Durable recovery journal: pending until journal files or equivalent recovery
  artifacts survive process failure and classify the target as old, new, or
  blocked.
- WordPress integration: Playground base/local/remote fixtures now smoke-test
  and export planner snapshots. Guarded apply now runs into a fresh Playground
  source with WordPress-visible readback; production push behavior remains
  pending until mutations flow through the intended HTTP source endpoint and are
  verified there.
- Plugin validators or drivers: pending until plugin-specific semantics are
  implemented and tested against real plugin-owned data.
