# Reprint Experimental Push

This repository is the push-back lab for
[`adamziel/reprint`](https://github.com/adamziel/reprint). Reprint already has a
pull path for cloning a WordPress site over HTTP. The open problem here is the
reverse direction: after a local site was pulled and edited, safely push local
changes back to the original source site even though that source may still be
live and may have changed.

The priorities are deliberately repetitive:

1. No data loss.
2. No data loss.
3. Reliable.
4. Fast.

The current code is not a production WordPress push transport. It is an
executable safety model: a deterministic JSON-snapshot planner, an atomic
applicator, lab-only Playground fixture endpoints, and scenario tests that
define the invariants the production transport must satisfy.

## Current Prototype

```bash
npm test
```

Run the no-server WordPress Playground integration harness:

```bash
npm run test:playground
```

Run the standalone local-only HTTP REST lab harness:

```bash
npm run test:playground:http-push
```

Run the DB-backed journal/idempotency REST lab harness:

```bash
npm run test:playground:db-journal-idempotency
```

Run the DB-backed process-kill/restart smoke:

```bash
npm run test:playground:db-journal-process-kill
```

Run the lab recovery inspection harness:

```bash
npm run test:playground:recovery
```

Run the file-backed JSON recovery journal restart smoke:

```bash
npm run test:recovery:file-journal
```

The Playground target is the lab proof for real WordPress fixture state. It
exports snapshots from Playground sites, exercises conflict planning from those
snapshots, creates a ready plan with `remote=base`, applies that plan inside a
fresh Playground source site, and verifies WordPress-visible posts, options, and
files after apply. The Playground protocol smoke also exercises a fixture-scoped
dry-run/apply endpoint: dry-run is read-only by same-process before/after
readback, apply requires a supplied dry-run receipt before it can mutate the
eight expected fixture resources, and the endpoint verifies hashes after apply.
Missing receipts fail before mutation with `MISSING_DRY_RUN_RECEIPT`, tampered
receipts fail before mutation with `RECEIPT_MISMATCH`, stale apply fails with
`PRECONDITION_FAILED`, and non-ready conflict plans fail with `PLAN_NOT_READY`.
The verified plugin-owned data slice is narrow: blueprints include the
`reprint_push_forms_fixture` option, fixture-marked parent posts with
`_reprint_push_forms_schema` postmeta, detection-only
`wp_reprint_push_forms_lab` custom-table rows, and
`reprint-push-forms-fixture` plugin metadata. Apply is allowed only for
allowlisted fixture option/postmeta resources; custom-table rows and plugin
metadata are exported and can block as `unsupported-plugin-owned-resource`, but
are not applied.
This remains a lab harness, not production Reprint HTTP source mutation support.
Its receipts are hash-bound to plan, mutation, precondition, and resource
evidence, and its journal checks are fixture-scoped lab audit evidence, not a
durable production journal, auth model, or signing scheme.

The `test:playground:http-push` script starts disposable Playground servers
bound only to `127.0.0.1` and verifies a local-only REST lab namespace,
`reprint-push-lab/v1`, with `GET /snapshot`, `GET /journal`, `POST /dry-run`,
and `POST /apply`. It covers namespace discovery, snapshots, journal readback,
read-only dry-run, required dry-run receipts, successful apply of the current
eight ready mutations, tampered receipt refusal, stale remote refusal, and
row/file/plugin-data conflict classes. It is intentionally standalone because it
starts real HTTP servers and takes around two minutes; it is not included in
`test:playground`.

The `test:playground:db-journal-idempotency` script verifies a separate
DB-native lab journal for `POST /apply`. Apply now requires
`X-Reprint-Push-Idempotency-Key`; a missing key returns
`400 MISSING_IDEMPOTENCY_KEY` before mutation. The table
`wp_reprint_push_lab_push_journal` records DB-native events including
`idempotency-opened`, `apply-started`, per-mutation `mutation-applied`,
`apply-committed`, replay evidence, and conflict evidence. Same key plus same
body returns `BATCH_ALREADY_COMMITTED` with `idempotency.replayed: true`, no
fresh mutation work, no extra mutation events, and an unchanged snapshot. Same
key plus a different body returns `409 IDEMPOTENCY_KEY_CONFLICT` before
mutation. The same harness also verifies the DB-native claim path: a unique
`claim_key_hash` opens exactly one first-apply claim before mutation, concurrent
same-key/same-body first applies produce exactly one fresh mutation executor,
and the duplicate request returns safe in-progress/retry/replay behavior without
running mutations. Concurrent same-key/different-body applies reject the loser
with `409 IDEMPOTENCY_KEY_CONFLICT` before mutation. This DB journal is separate
from the legacy `wp_options` lab journal read by `GET /journal`; both are
fixture-scoped evidence.

The `test:playground:db-journal-process-kill` script runs a local-only
Playground process-kill smoke over a host-mounted WordPress directory. It sends
a real `SIGKILL` to the localhost Playground server during an in-flight
DB-journaled REST apply, restarts against the same mount, and verifies DB
`idempotency-opened`/`apply-started` rows persist without a false
`apply-committed`, live target hashes are explainable as old/new with no silent
divergence, `GET /recovery/inspect` reports `blocked-recovery`, and retry does
not overwrite the partial state. This is local Playground SQLite/host-mount lab
evidence only, not production durability. DB-native per-mutation evidence can be
short after hard kill because mutation rows append after protocol return;
option-journal/live hashes carry partial evidence today. Missing-commit
finalization/replay remains pending.

The `test:playground:recovery` script exercises the lab-only failpoint
`REPRINT_PUSH_LAB_FAIL_AFTER_MUTATIONS=N` / `labFailAfterMutations`. The
verified fail-after-2 case records `LAB_INJECTED_APPLY_FAILURE` after two
successful whole-resource mutations, classifies the remote as
`blocked-recovery`, reports `2 new` and `6 old` targets through CLI/REST
inspection, and refuses retry with `PRECONDITION_FAILED`. This is bounded lab
inspection over option-journal evidence with hashes only; it is not
durable production recovery or auto-repair.

The `test:recovery:file-journal` script verifies the JSON-model file-backed
recovery journal. It writes append-only JSONL records with monotonic sequences,
includes `fsync` evidence after each append, inspects persisted journal files
after restart-style module reloads, verifies old-remote before mutation,
`blocked-recovery` after fail-after-2 with `2 new` and `6 old` targets, retry
refusal with `PRECONDITION_FAILED` and no remote change, completed replay with
`0` additional mutations, drift outside before/after hashes as
`blockedUnknown > 0`, and no raw fixture fields/data in journal files. This is
still JSON-model lab evidence, not production WordPress recovery: it does not
replace the DB table journal or the local Playground process-kill smoke, and
the per-append `fsync` evidence is lab evidence rather than full production
durability. Journal paths must be unique or reset intentionally because plan
journal open defaults to `truncate`, and raw-value prevention is
forbidden-key/fixture-string based rather than a complete allowlist schema.

The lab CLI works on three snapshots:

```bash
reprint-push-lab plan \
  --base pulled-base.json \
  --local local-edited.json \
  --remote live-remote.json \
  --out push-plan.json

reprint-push-lab apply \
  --remote live-remote.json \
  --plan push-plan.json \
  --out remote-after.json
```

The model uses a three-way base/local/remote comparison. A plan may be:

- `ready`: safe to apply if all remote preconditions still match.
- `blocked`: dependencies or other hard gates are missing.
- `conflict`: local and remote both changed the same resource differently.

Apply revalidates remote preconditions immediately before mutation. If the live
remote changed after the dry run, apply refuses to run and leaves the remote
unchanged.

## Research Inputs

- Reprint pull pipeline: resumable preflight, file pull, database pull, database
  apply, runtime setup.
- ZS-Sync: authoritative-site scanners, resource metadata, cursoring, and
  resource fetch APIs.
- ForkPress: branch merge, audit logs, conflict lifecycle, plugin validators,
  rollback, and crash-recovery model.

See [docs/source-notes.md](docs/source-notes.md) and
[docs/approach-scorecard.md](docs/approach-scorecard.md).

## Progress

The public status page lives at [progress.html](progress.html). It is designed
to be served through GitHub Pages from this repository.
