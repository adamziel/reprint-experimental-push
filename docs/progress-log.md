# Progress Log

This log records evidence present in this repository. Percentages must remain
conservative until they are backed by executable tests, integration runs, or
linked implementation artifacts.

## 2026-05-24 - Baseline Evidence Pass

- `npm test` passed with 29 Node test scenarios covering the deterministic JSON
  snapshot planner and applicator. Evidence:
  [test/push-planner.test.js](../test/push-planner.test.js) and
  [test/performance-model.test.js](../test/performance-model.test.js).
- The current planner implements three-way base/local/remote comparison,
  conflict stops, remote-only preservation, plugin-owned conflict
  classification, atomic intent dependency checks, dependency version/hash
  checks, stale remote dependency blocking, and precondition hashes. Evidence:
  [src/planner.js](../src/planner.js).
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

## 2026-05-24 - Playground Fixture Protocol Smoke

- `npm run test:playground` now includes
  `scripts/playground/push-protocol-smoke.mjs`, which mounts the lab-only
  `scripts/playground/push-remote-endpoint.php` and
  `scripts/playground/push-remote-lib.php` files into no-server Playground.
- The smoke proves dry-run is read-only by same-process WordPress before/after
  readback, applies a ready fixture plan with a supplied dry-run receipt,
  verifies five fixture mutations and hashes, rejects missing receipts with
  `MISSING_DRY_RUN_RECEIPT`, rejects tampered receipts with
  `RECEIPT_MISMATCH`, rejects stale apply with `PRECONDITION_FAILED`, and
  preserves the drifted remote fixture.
- Conflict dry-run and apply both refuse with `PLAN_NOT_READY` and return audit
  evidence for row, file, and plugin-data conflict classes.
- Receipts are bound to the plan fingerprint/hash, mutation and precondition
  sets, ordered resource keys, and dry-run actual hashes. The PHP endpoint
  records bounded fixture-scoped lab journal/audit option events for dry-run,
  apply, stale, non-ready, missing-receipt, and mismatch outcomes. This remains
  fixture-scoped lab evidence, not durable production journaling. Production
  Reprint HTTP source mutation support remains pending.

## 2026-05-24 - Status By Area

| Area | Progress | Evidence | Still pending |
| --- | ---: | --- | --- |
| Merge invariants | 35% | Planner/apply tests; [scenario matrix](scenario-matrix.md); Playground snapshot planner/apply/protocol harness in [playground topology](playground-topology.md) | SQL/file mutation semantics beyond the fixture harness, live-site mutation checks |
| Recovery boundaries | 14% | Journal/recovery artifacts in [src/apply.js](../src/apply.js) and tests | Durable on-disk journal, process-kill tests, storage-level recovery proof |
| Reliable executor and protocol | 18% | [protocol](protocol.md), [executor](executor.md), protocol fixtures, Playground snapshot extraction, guarded Playground apply, and fixture-scoped Playground protocol smoke | Production Reprint protocol extension, real WordPress mutation executor, remote audit records |
| Fast path and chunking | 12% | [fast paths](fast-paths.md) and [performance model tests](../test/performance-model.test.js) | Real transfer benchmarks, streaming implementation, large-site runtime evidence |
| Independent evidence and critique | 25% | [objective audit](../audits/objective-audit.md), [critic audit](../audits/critic.md), [source notes](source-notes.md) | External audit of live integration behavior |

## 2026-05-24 - Explicit Pending Proof Gates

- Real WordPress executor: pending until a source site is mutated through the
  intended production protocol and verified after apply. The current Playground
  protocol smoke is a fixture-scoped lab endpoint only.
- Durable recovery journal: pending until journal files or equivalent recovery
  artifacts survive process failure and classify the target as old, new, or
  blocked.
- WordPress integration: Playground base/local/remote fixtures now smoke-test,
  export planner snapshots, run guarded apply into a fresh Playground source,
  and exercise a lab-only fixture protocol endpoint with WordPress-visible
  readback. Production push behavior remains pending until mutations flow
  through the intended HTTP source endpoint and are verified there.
- Plugin validators or drivers: pending until plugin-specific semantics are
  implemented and tested against real plugin-owned data.
