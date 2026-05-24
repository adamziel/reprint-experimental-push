# Objective Audit

## Verdict

The project is **not releasable as a production WordPress push path**.

Fresh remote heads after restart:

- `origin/lane/reliable-executor` is `b725b2d3`
- `origin/lane/no-data-loss-invariants` is `b9aebe71`
- `origin/lane/no-data-loss-recovery` is `134d0401`
- `origin/lane/critic` is `1e545163`
- `origin/lane/independent-auditor` is `781888d9`
- `origin/lane/progress-publisher` is `11aca375`

The last 12 hours changed evidence, not the gate status. New release-boundary and no-data-loss material exists, including an explicit `PRODUCTION_DURABLE_JOURNAL_STORAGE_REQUIRED` verdict and stronger release-surface planner/recovery proof. But the proof still stops short of the production auth/session lifecycle and durable production journal ownership with lease/fencing that the objective requires.

That means the honest release claim is still narrower: this repository is a strong lab and release-surface safety model for push invariants. It does **not** yet prove production-safe live WordPress push without data loss, with production reliability, and with measured speed.

## Explicit Requirements

The objective is to push local changes back to the original WordPress source site after a pull, while that source may still be live and may have changed. The release requirements implied by that objective are:

1. Persist a complete pull-base manifest with stable resource identities, hashes, ownership hints, schema fingerprints, and protocol metadata.
2. Read the current live remote state before planning and compare base, local, and remote in a three-way plan.
3. Preserve remote-only changes by default, including deletes, plugin state, files, rows, and related resources.
4. Stop on local/remote conflicts with durable, redacted evidence that an operator can inspect.
5. Apply every mutation only behind a live precondition that is rechecked immediately before the write.
6. Enforce storage-boundary guarded writes, or an equivalent compare-and-swap primitive, for every production DB and filesystem mutation.
7. Treat coupled file, DB, plugin, option, activation, and schema changes as atomic groups. Never report success for a split plugin/application state.
8. Reject plugin-owned, serialized, custom-table, or schema-sensitive data unless an explicit validator or semantic driver proves the mutation.
9. Authenticate and authorize source-site mutation with production credentials, scoped push permissions, replay protection, and TLS outside local-only tests.
10. Keep dry-run honest: dry-run is planning evidence only; apply must still refuse stale or changed remote state.
11. Persist a durable production journal sufficient to classify failure as old remote, fully updated remote, or blocked recovery.
12. Make apply idempotent and resumable across duplicate requests, chunks, process failures, stale claims, and operator retries.
13. Prove behavior against real WordPress data shapes: uploads, posts, postmeta, terms, users, options, plugin tables, plugin activation, schemas, and multisite if in scope.
14. Redact raw private data from plans, journals, conflict reports, recovery reports, and test artifacts.
15. Prove speed with measured large-site benchmarks while preserving every no-data-loss and reliability guard.
16. Provide a release test suite that actually runs the safety, recovery, auth, storage, plugin, and performance gates intended to support public claims.

## Evidence Table

| Requirement | Current proof | Missing proof | Release blocker |
| --- | --- | --- | --- |
| R1 base manifest | The planner and fixture exporters carry stable resource keys and hashes for local/lab snapshots. | No production pull-base manifest contract for the full WordPress graph. | Yes |
| R2 three-way planning | Unit tests compare base/local/remote hashes and keep remote-only changes by default. | No checked production-source comparison run from this checkout. | Yes |
| R3 preserve remote-only changes | Planner tests keep remote-only files, rows, and plugin metadata. | No live WordPress graph proof that all relevant relationships are preserved. | Yes |
| R4 redacted conflicts | Planner and recovery tests assert redaction in local fixture conflicts and journals. | No production-bound conflict/report artifact contract. | Yes |
| R5 live preconditions | Planner/apply tests require live-remote preconditions before mutation. | No checked production apply run that revalidates at the live boundary. | Yes |
| R6 guarded writes | Storage-guarded fixture smokes prove some DB row and file paths reject drift. | No production storage-bound proof for every mutation type. | Yes |
| R7 atomic groups | Planner and plugin tests model coupled plugin/file/data groups. | No production proof for split plugin/application states across real WordPress resources. | Yes |
| R8 plugin/schema-sensitive data | Tests block or constrain plugin-owned and custom-table data without explicit driver evidence. | No real plugin validator contract at the production boundary. | Yes |
| R9 auth and authorization | Local authenticated routes and production-shaped route/package tests prove lab protocol shape. | No production credentials, TLS, replay-protection, or session lifecycle proof. | Yes |
| R10 honest dry-run | Dry-run and preflight smokes refuse stale or changed lab state. | No production apply confirmation that stale state is still refused after dry-run. | Yes |
| R11 durable journal | Recovery tests and lab smokes prove journaling, replay, and restart classification. | No production durable journal storage with lease/fencing ownership. | Yes |
| R12 resumability | Duplicate/replay, stale claim, and restart smokes exist in fixtures. | No production duplicate-request or chunk-resume proof. | Yes |
| R13 real WordPress shapes | Fixtures cover selected posts, options, files, plugin metadata, and a custom table. | No broad production-backed matrix for uploads, postmeta, terms, users, plugin tables, activation, schema changes, or multisite. | Yes |
| R14 redaction | Selected tests verify redaction of raw fixture values. | No formal allowlist for all future production artifacts. | Yes |
| R15 speed | `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove model-level speed guardrails. | No measured live-site throughput or memory evidence. | Yes |
| R16 release suite | `npm test` passes, and the long Playground smokes pass when invoked explicitly. | No CI/default entrypoint that runs the full safety-critical release set. | Yes |

## Test Audit

### What The Default Tests Prove

`npm test` passed during this audit with 89 tests, 0 failures, and 0 skips.

- `test/push-planner.test.js` proves planner behavior, live-remote precondition tracking, conflict refusal, atomic group handling, and plugin-owned resource policy in local fixtures.
- `test/recovery-journal.test.js` proves JSONL monotonicity, redaction, restart classification, and drift detection in temporary files.
- `test/performance-model.test.js` proves a deterministic speed model and refuses unsupported throughput claims.
- `test/guarded-executor-benchmark.test.js` proves the benchmark model moves staged buffers and row payloads through durable evidence while still blocking unsupported production throughput claims.

These tests are useful, but they are still local invariants, fixture checks, or model-level claims. They do not prove no data loss, reliability, or speed on a live production WordPress source site.

### What The Standalone Smokes Prove

- `npm run test:playground:production-shaped-push` passed against `/wp-json/reprint/v1/push/*`, applied 8 fixture mutations, replayed with zero fresh mutation work, rejected cross-route receipts before mutation, and classified recovery as `fully-updated-remote`.
- `npm run test:playground:production-plugin-package` passed with the temporary `reprint-push` plugin mounted as a normal plugin, the public lab namespace disabled, 8 fixture mutations applied, and the final visible fixture surface matching local.
- The current progress log also records fresh release-surface evidence: the `536015fb` release verifier path adds `remoteSnapshotHashes`, `protocolExtension`, persistent journal-file checks, `filesystem-compare-rename` lease fencing, `fsync` evidence, monotonic sequence behavior, and explicit durable-journal boundary verdicts. The restart-era evidence update now moves that verifier tip to `b725b2d3`, and the no-data-loss and recovery lanes now point at `b9aebe71` and `134d0401`.

These smokes are still lab-bound. They improve confidence, but they do not prove production durability, arbitrary WordPress resources, real MySQL/InnoDB behavior, production auth, or measured speed.

## Evidence Table Deltas

| Area | Directly observed proof | Still insufficient | Next proof required |
| --- | --- | --- | --- |
| No-overwrite planner | Unit tests cover unchanged remote mutations, remote-only preservation, deletion behind preconditions, delete/update conflict, directory deletion that would hide a remote-only descendant, file type swap that would hide a remote-only descendant, matching independent edits, plugin dependency drift, stale precondition refusal, and redacted plugin-data conflict evidence. | These are JSON-model resources plus fixture policy, not WordPress graph semantics. | Add one real WordPress graph fixture where local and remote edit different related resources, then prove the planner blocks or preserves every relationship explicitly. |
| Recovery and idempotency | Unit tests cover JSONL journal creation, monotonic sequences, per-record `fsync` evidence, old/new/blocked classification, corrupt/truncated journal blocking, missing-target blocking, completed replay, journal envelope mismatch, and partial remote mutation as blocked recovery. Playground smokes cover DB journal, same-key replay, conflict refusal, process kill, missing-commit finalization, and all-old stale-claim retry. | JSONL recovery is still a model. Playground DB recovery is fixture-scoped local storage evidence. | Kill the production-backed executor at every guarded DB/file/plugin boundary and retain DB journal plus live hash evidence for old/new/blocked classification. |
| Speed | `test/performance-model.test.js` and `test/guarded-executor-benchmark.test.js` prove a guarded model for chunk staging, bounded DB batches, preconditions, atomic group visibility, backpressure, bounded buffer movement, and rejected unsafe fast paths. | The benchmark evidence is still model-level and fixture-shaped. It does not measure production throughput, memory ceiling, retry cost, or live large-site behavior under load. | Run a large-file and large-table benchmark through the production-backed executor with receipts, preconditions, journal cursors, retries, and measured memory/runtime. |

## Why The Gates Stay `0/4`

The last 12 hours changed evidence, not gate status. The new proof now shows a real release-boundary planner result and an explicit durable-journal boundary verdict, but it still does not prove the production auth/session lifecycle or a durable production journal with lease/fencing.

The exact proof that would move one gate is one checked production-boundary run from this checkout that starts from a live source snapshot, authenticates with production credentials, writes through the durable journal boundary, and survives recovery without data loss while also reporting the live precondition, preserved-remote drift, and machine-checkable release verdicts.

Until that exists, the release claim stays scoped to lab evidence for push safety invariants, not production-safe live WordPress push.
