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

The Playground target is the lab proof for real WordPress fixture state. It
exports snapshots from Playground sites, exercises conflict planning from those
snapshots, creates a ready plan with `remote=base`, applies that plan inside a
fresh Playground source site, and verifies WordPress-visible posts, options, and
files after apply. The Playground protocol smoke also exercises a fixture-scoped
dry-run/apply endpoint: dry-run is read-only by same-process before/after
readback, apply requires a supplied dry-run receipt before it can mutate the
five expected fixture resources, and the endpoint verifies hashes after apply.
Missing receipts fail before mutation with `MISSING_DRY_RUN_RECEIPT`, tampered
receipts fail before mutation with `RECEIPT_MISMATCH`, stale apply fails with
`PRECONDITION_FAILED`, and non-ready conflict plans fail with `PLAN_NOT_READY`.
This remains a lab harness, not production Reprint HTTP source mutation support.
Its receipts are hash-bound to plan, mutation, precondition, and resource
evidence, and its journal checks are fixture-scoped lab audit evidence, not a
durable production journal, auth model, or signing scheme.

The `test:playground:http-push` script starts disposable Playground servers
bound only to `127.0.0.1` and verifies a local-only REST lab namespace,
`reprint-push-lab/v1`, with `GET /snapshot`, `GET /journal`, `POST /dry-run`,
and `POST /apply`. It covers namespace discovery, snapshots, journal readback,
read-only dry-run, required dry-run receipts, five-mutation apply success,
tampered receipt refusal, stale remote refusal, and row/file/plugin-data
conflict classes. It is intentionally standalone because it starts real HTTP
servers and takes around two minutes; it is not included in `test:playground`.

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
