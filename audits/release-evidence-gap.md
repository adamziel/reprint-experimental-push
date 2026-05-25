# Release Evidence Gap

This note isolates what the current test surface proves and what it still does not prove for a production release claim.

## Current Proof

- `npm test` proves model-level invariants and fixture behavior.
- `test/recovery-journal.test.js` proves file-backed journal append/restart behavior, redaction, and recovery classification in the journal model.
- `test/performance-model.test.js` proves the benchmark model carries proof obligations and refuses unsupported speed claims.
- `test/guarded-executor-benchmark.test.js` proves production throughput claims stay blocked when the benchmark evidence is incomplete.
- `npm run test:playground:*` commands prove local Playground and route-shape flows, including auth and journal scenarios.

## Missing Proof

- No test proves a live WordPress source site survives a failed push with no data loss across posts, postmeta, uploads, taxonomies, menus, users, plugin-owned rows, or serialized payloads.
- No test proves production auth/session, lease, fencing, and durable journal behavior on the real transport path.
- No test proves the actual remote/local topology with a live source and live push target.
- No test measures a production push path with a defined runtime or memory threshold.
- No required command composes those checks and fails closed when any one of them is still lab-backed or fixture-only.

## Release Blocker

The tests are credible refusal evidence, but they are not yet release evidence.

The project remains blocked until one enforced release gate exists and the live-source path is exercised with the same storage, auth, journal, crash, and graph semantics that production depends on.
