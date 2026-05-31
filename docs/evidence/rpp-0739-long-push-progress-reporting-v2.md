# RPP-0739 long-push progress reporting variant 2 evidence

Evidence for RPP-0739. This slice is support-only and builds on the RPP-0719
long-push progress reporting benchmark. Final release remains **NO-GO** because
this proof does not supply a live production remote service, production storage
receipts, production row batch execution, production atomic group commit
evidence, or release-verifier carry-through.

## Proof scope

The focused proof test
`test/rpp-0739-long-push-progress-reporting-v2.test.js` exercises the RPP-0719
large-site profile and wraps its progress stream in variant 2 support evidence.

Variant 2 asserts:

- the large-site benchmark uses the documented long-push progress workload and
  budget;
- the run finishes within the documented duration and heap budgets;
- operator progress events are bounded by completed-action and upload-byte
  reporting gaps;
- required phases are covered from plan scanning through atomic commit;
- progress counters are monotonic and completion reaches 100 percent only on
  final durable commit evidence;
- durable cursor references and event-window hashes are hash-only and
  recomputed before output;
- emitted progress proof output is blocked until correctness gates are recorded
  and passing;
- over-budget, missing-event, stale-cursor, and premature-pass evidence fails
  closed; and
- the proof remains support-only with final release and integration
  recommendation set to `NO-GO`.

## Observed large-site summary

Focused RPP-0719-backed large-site benchmark summary from this sandbox:

- profile: `large-site`
- total scheduled actions: `254`
- upload chunks: `206`
- upload bytes: `1711276032`
- database batches: `27`
- database rows: `12620`
- operator progress events: `40`
- maximum completed-action gap between reports: `8`
- maximum upload-byte gap between reports: `67108864`
- duration: `8.57 ms` within the documented `5000 ms` budget
- heap used: `5412592 bytes` within the documented `268435456 bytes` budget
- RSS: `55742464 bytes`
- CPU: `8.02 ms user`, `0.10 ms system`

The underlying RPP-0719 benchmark gates all reported `pass`:

- `progress-event-schema`
- `phase-coverage`
- `monotonic-progress-counters`
- `bounded-operator-update-gaps`
- `durable-evidence-backed-progress`
- `hash-only-progress-redaction`
- `completion-after-final-durable-evidence`
- `large-site-runtime-budget`

## Variant 2 gates

The RPP-0739 proof recomputes this gate vector from the hash-only progress
event projection before emitting output:

1. `benchmark-gates-pass`
2. `documented-large-site-budget`
3. `progress-policy-v2-support-contract`
4. `phase-coverage-complete`
5. `monotonic-progress-events`
6. `bounded-operator-update-gaps`
7. `durable-cursor-hashes-match`
8. `completion-after-final-durable-evidence`
9. `hash-only-progress-evidence`
10. `support-only-release-no-go`

The output is emitted only after all ten gates pass. If the evidence claims
`passed` before the gate vector is present and passing, the resolver blocks the
output and records `correctness-gates-not-recorded`.

## Progress and performance posture

Recorded progress boundary:

- policy id: `rpp-0719-long-push-progress-reporting`
- source policy variant: `1`
- support proof variant: `2`
- event schema version: `1`
- durable boundary: durable plan, receipt, staging, and commit evidence
- operator output boundary: hash-only progress events
- completion rule: 100 percent only after final durable commit evidence
- final event kind: `push-complete`
- final event phase: `commit`
- final durable action type: `atomic-group-commit`

Recorded performance boundary:

- documented profile: `large-site`
- documented duration budget: `5000 ms`
- documented heap budget: `268435456 bytes`
- minimum upload bytes: `1073741824`
- minimum database rows: `10000`
- observed duration: `8.57 ms`
- observed heap used: `5412592 bytes`
- final budget gate: `pass`

## Negative coverage

The focused proof mutates otherwise passing progress evidence and verifies
fail-closed behavior:

- over-budget evidence sets duration above the documented maximum and blocks on
  `documented-large-site-budget`;
- missing-event evidence removes a progress event and blocks on
  `bounded-operator-update-gaps`;
- stale-cursor evidence changes a recorded durable cursor hash and blocks on
  `durable-cursor-hashes-match`; and
- premature-pass evidence clears the recorded gate vector while leaving status
  as `passed`, then blocks on `correctness-gates-not-recorded`.

All unsafe decisions suppress output and record deterministic decision hashes.

## Support-only release posture

This evidence remains support-only:

- `supportOnly: true`
- `productionBacked: false`
- production throughput is `not-claimed`
- speed claims are disabled
- live production remote service is `not-claimed`
- production storage receipts are `not-claimed`
- production row batch executor is `not-claimed`
- production atomic group commit is `not-claimed`
- release-verifier carry-through is `not-claimed`
- final release status is `NO-GO`
- integration recommendation is `NO-GO`

This proof does not claim live production throughput, release approval, or
rollout safety. It proves only local support-path progress reporting,
hash-only durable cursor evidence, runtime/resource gates, and fail-closed
stale or incomplete progress evidence behavior.

## Redaction posture

Progress evidence is hash-only for durable resource and cursor references. It
stores counts, budgets, process resource measurements, event sequence metadata,
counter snapshots, phase names, event hashes, collection hashes, and gate
decision hashes. It does not store file bodies, row payloads, option values,
meta values, absolute paths, live service configuration, authorization headers,
or private site values.

## Validation

Focused validation commands for this slice:

- `node --check test/rpp-0739-long-push-progress-reporting-v2.test.js`
- `node --test --test-name-pattern RPP-0739 test/rpp-0739-long-push-progress-reporting-v2.test.js`
- `node --test --test-name-pattern RPP-0719 test/rpp-0719-long-push-progress-reporting.test.js`
- `node --test --test-name-pattern RPP-0732 test/rpp-0732-dry-run-batch-sizing-v2.test.js`
- `node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0739-long-push-progress-reporting-v2.md`
- `git diff --check`
- `git diff --cached --check`

Observed focused proof result:

- RPP-0739 proof test: 2 pass, 0 fail
- Adjacent RPP-0719 long-push progress reporting test: 3 pass, 0 fail
- Adjacent RPP-0732 dry-run batch sizing variant 2 test: 2 pass, 0 fail
- Evidence redaction scan: `ok: true`, 0 rejected files
- Diff whitespace checks: clean
