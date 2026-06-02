# Reprint Experimental Push

Reprint Experimental Push is the push-back safety lab for
[`adamziel/reprint`](https://github.com/adamziel/reprint). It models how a
site that was pulled from a source WordPress site can be edited locally and then
pushed back without overwriting newer source-side work.

This repository contains an executable protocol model, a WordPress source-site
plugin prototype, CLI tools, Playground and Docker harnesses, scenario
generators, release-gate checks, and operator-facing evidence docs.

## Current Status

The current trunk can produce a release `GO` for the constrained Docker
local-production proof:

```bash
npm run verify:release:docker-local-production
```

That means the modeled push path can pass the required release gate for the
known topology: one original source site, one local edited site, one changed
remote source, and an apply/revalidation source inside an isolated Docker
network.

It does not mean this repository is a general-purpose production WordPress push
transport for arbitrary customer sites. Production deployment still needs the
real Reprint source mutation endpoint, production authentication/session
binding, backups, operator rollout, monitoring, and site-specific integration
work described below.

Some files under `docs/evidence/` and `docs/release/` are historical evidence
records and may mention earlier `NO-GO` states. Treat the current release status
as the result of running `scripts/release/check-release-gates.mjs` against fresh
evidence artifacts.

## What This Project Proves

Reprint's pull flow starts with a source WordPress site and produces a local
editable copy. The hard part is pushing local edits back after the source site
may have changed independently.

This project proves a conservative push model:

- Build every push from an immutable pulled base snapshot.
- Compare the local edited state to that base.
- Compare the current remote source state to that same base.
- Push only changes whose preconditions still match the source site.
- Preserve remote changes that happened after the pull.
- Refuse conflicts before mutation.
- Revalidate immediately before each apply batch.
- Record enough journal evidence to recover or refuse safely.

The result is a fail-closed model for WordPress content, metadata, files, and
selected plugin-owned resources.

## Safety Model

The protocol is intentionally staged. Each stage either produces evidence for
the next stage or refuses before writes happen.

1. `push_preflight`
   Binds the persisted pull base package to the live remote identity and the
   authenticated push session.

2. `push_snapshot_hashes`
   Captures planning evidence without exposing full private content in release
   records.

3. `push_plan_dry_run`
   Produces a plan and receipt. This is read-only evidence, not a write lock.

4. `push_batch_apply`
   Revalidates live source evidence before every mutation batch and again at
   storage boundaries.

5. `push_journal`
   Persists apply intent, receipts, commit state, and recovery classifications.

6. `push_recover inspect`
   Reads journal and live state first. It does not mutate.

7. `push_recover auto|finish|rollback`
   Mutates only after recovery evidence classifies the state as safe.

The important invariant is that a dry-run receipt is never trusted by itself.
Authenticated receipts expire, bind the route/exporter protocol contract, and
carry hash-only plan, session, source, precondition, and snapshot evidence, but
apply still must prove that the live source matches the receipt's preconditions.

## Feature Map

| Area | What exists today |
| --- | --- |
| Planning | Three-way diff over base, local, and remote snapshots with `ready`, `blocked`, and `conflict` outcomes. |
| Apply | Batch apply guarded by expected hashes, stale-plan rejection, idempotency keys, and revalidation before writes. |
| Resources | File resources, WordPress row resources, plugin resources, selected metadata rows, and fixture-scoped plugin-owned tables. |
| Remote preservation | Remote-only changes and unplanned remote drift are preserved unless a planned change explicitly owns that resource. |
| Conflict handling | Overlapping local and remote edits refuse before mutation. Non-ready entries suppress overlapping writes. |
| Plugin-owned data | Owner context, merge-driver evidence, validation checks, and allowlist boundaries for plugin-owned mutations. |
| Authentication | Authenticated lab and production-shaped routes with session/receipt checks, receipt expiry, and protocol-bound dry-run evidence. Production auth integration is still a required integration point. |
| Journaling | File-backed recovery journal plus recovery tests for partial apply, replay, finish, rollback, and refusal states. |
| Release gates | Machine-checkable release evidence, provenance coverage, redaction checks, and GO/NO-GO evaluation. |
| Docker proof | Isolated multi-site topology with runner-local proxies and no public network tunnels. |
| Playground proof | Disposable WordPress Playground topologies for fast protocol and REST-route verification. |

## Repository Layout

| Path | Purpose |
| --- | --- |
| `src/` | Core planner, apply, resources, journal, recovery, and validation logic. |
| `bin/reprint-push-lab.js` | CLI for deterministic snapshot planning, apply, and authenticated push flows. |
| `plugins/reprint-push/` | WordPress plugin wrapper for the source-site push endpoint prototype. |
| `scripts/playground/` | Playground blueprints, route plugins, and topology proof scripts. |
| `scripts/docker/` | Docker local-production harnesses and complex-site proof orchestration. |
| `scripts/release/` | Release-gate and evidence validation tools. |
| `test/` | Unit, integration, recovery, topology, Docker, and generated scenario tests. |
| `docs/` | Protocol, topology, scenario matrix, operator runbook, evidence, and recovery documentation. |

## Supervised Lanes

Parallel implementation cycles are coordinated through tmux sessions and
worktrees. The lane runbook is `docs/supervised-lanes.md`.

Check the current lane state:

```bash
scripts/supervision/status.sh
```

Run the accountability check when taking over supervision:

```bash
scripts/supervision/accountability.sh
```

The supervised-lanes docs explain the active worktrees, session names, feedback
supervisor, progress publisher, and worker defaults.

## Quick Start

Requirements:

- Node.js 20 or newer.
- `npm`.
- Docker, for the production-shaped local proof.
- Network access when running WordPress Playground package downloads.

Run the fast local test suite:

```bash
npm test
```

Run the broader release gate:

```bash
npm run verify:release
```

Run the Docker local-production proof:

```bash
npm run verify:release:docker-local-production
```

Check a release evidence artifact:

```bash
npm run check:release-gates -- --evidence-file /path/to/release-gate-input.json
```

Only the sandbox-provided port `8080` should be exposed when serving local
sites from this environment. Do not use remote tunneling services.

## CLI Usage

The lab CLI works with deterministic JSON snapshots and authenticated test
routes. It is useful for reproducing small cases without starting the full
Docker topology. The snapshot filenames below are placeholders; replace them
with exported base, local, and live remote snapshot paths.

Plan a push:

```bash
node bin/reprint-push-lab.js plan \
  --base pulled-base.json \
  --local local-edited.json \
  --remote live-remote.json \
  --out /tmp/reprint-plan.json
```

Apply a plan to a snapshot:

```bash
node bin/reprint-push-lab.js apply \
  --remote live-remote.json \
  --plan /tmp/reprint-plan.json \
  --out /tmp/reprint-applied.json
```

Run an authenticated push against a source-site route:

```bash
node bin/reprint-push-lab.js push-authenticated \
  --base pulled-base.json \
  --local local-edited.json \
  --source-url http://127.0.0.1:9400 \
  --username admin \
  --application-password "$APP_PASSWORD" \
  --idempotency-key local-run-001 \
  --route-profile production-shaped \
  --out /tmp/reprint-push-result.json
```

Use `--dry-run-only` when you want a receipt and plan without apply.

## WordPress Integration Points

### Source-Site Plugin

`plugins/reprint-push/reprint-push.php` is the production-shaped WordPress plugin
entry point. By default it disables lab routes and auth bootstrap helpers:

```php
REPRINT_PUSH_DISABLE_LAB_ROUTES
REPRINT_PUSH_DISABLE_AUTH_BOOTSTRAP
```

That default matters. A production integration should explicitly choose the
routes, auth model, and operational controls it enables.

### REST Routes

The lab route namespace is:

```text
reprint-push-lab/v1
```

Common routes include:

- `GET /snapshot`
- `GET /journal`
- `POST /dry-run`
- `POST /apply`

Authenticated and production-shaped tests exercise stricter preflight, receipt,
session, idempotency, and revalidation behavior. See `docs/protocol.md` and
`docs/playground-topology.md` for the contract.

### Resource Model

The core model uses typed resources:

- `file`
- `row`
- `plugin`

Rows cover selected WordPress tables and metadata patterns. Plugin-owned rows
require owner evidence and validator or merge-driver proof before mutation.
Unsupported plugin uninstall/delete and direct `active_plugins` mutation are
refused.

### Release Evidence

Release evidence is intentionally machine-readable. The release checker expects
coverage for proof stages, provenance, redaction, topology, recovery, and
guardrail outcomes.

The evidence should prove what happened without leaking full private payloads.
Prefer hashes, counts, resource identifiers, and receipts over full body content
unless a test explicitly needs payload inspection.

## Docker Production-Shaped Topology

The Docker proof runs isolated WordPress sites on a private network:

- source site
- local edited site
- remote changed site
- apply/revalidation source
- runner

The runner talks to each site through loopback proxies. This keeps the proof
close to a production deployment shape while staying local and repeatable.

The topology proves that apply does not rely on stale dry-run assumptions: it
rechecks the live source before mutation and refuses when preserved remote state
changes unexpectedly.

## Scenario Coverage

The generated push harness covers 620 cases across 10 tiers and 62 scenario
families. The matrix covers:

- file changes, deletes, conflicts, and stale content
- row and metadata updates
- plugin-owned resources and validation evidence
- graph/reference rewrite fixtures
- atomicity and idempotency behavior
- remote preservation and stale-plan rejection
- recovery journal classifications
- release evidence provenance and redaction checks

See `docs/scenario-matrix.md` and `docs/generated-push-harness.md` for the
complete coverage map.

## Limitations

The current implementation is production-shaped, not a complete general
production push product.

Known remaining integration work includes:

- A real production Reprint HTTP source mutation endpoint.
- Production authentication, nonce/session cleanup, Application Password
  integration, and durable audit records.
- External production receipt signing against the deployed Reprint source
  protocol; the production-shaped route already expires receipts and binds them
  to the route/exporter contract.
- Full large file streaming integration: production-shaped routes now expose
  signed chunk manifest validation, bounded raw chunk staging, durable
  receipt-backed manifest finalization, staged-byte verification, and terminal
  rejected-row replay. Apply consumption of finalized chunks and true streaming
  request bodies remain release work.
- MySQL and SQLite transaction-boundary proof for all durable write surfaces.
- Production storage-level compare-and-swap or locking around final target
  writes.
- Production plugin activation/update flows with dependency and recovery checks.
- Object-cache, cron, generated-file, and maintenance-mode interactions.
- Generic plugin validator and merge-driver contracts beyond the current
  explicit row-driver schemas, root-closed row envelopes, scalar hash
  constraints, and fixture-scoped allowlists.
- General WordPress graph identity mapping and reference rewriting beyond the
  current stable fixtures.
- Production database-backed journal and kill-process recovery around every
  durable WordPress boundary.
- External hosted production smoke, soak, visual, and observability runs.

These are tracked as release-scope boundaries, not as hidden assumptions.

## Common Workflows

### Add a Scenario

1. Add or update the scenario in the relevant fixture or generated harness.
2. Assert both the positive path and the stale/conflict refusal path.
3. Confirm the plan reports the expected `ready`, `blocked`, or `conflict`
   state.
4. Add release evidence expectations if the scenario affects a gate.
5. Run the focused test first, then the release proof that owns the behavior.

### Prove a Release Gate

1. Run the proof script that produces fresh evidence.
2. Save the generated release-gate input path from the output.
3. Run `npm run check:release-gates -- --evidence-file <path>`.
4. Confirm `releaseStatus` is `GO`.
5. Keep the generated artifact available for audit if it backs a decision.

### Investigate a Refusal

1. Inspect the plan entries that are not `ready`.
2. Compare base, local, and remote hashes for the refused resource.
3. Check whether the refusal came from conflict, stale remote evidence,
   unsupported resource type, missing owner evidence, or validator failure.
4. Re-run with the smallest fixture that reproduces the refusal.
5. Only widen allowlists or merge-driver behavior after adding a refusal test.

## Documentation Map

| Document | Use it for |
| --- | --- |
| `docs/protocol.md` | Canonical push stages, invariants, and production-shaped contract. |
| `docs/plugin-driver-contracts.md` | Explicit plugin-owned row driver contract, evidence shape, and refusal policy. |
| `docs/wordpress-graph-contracts.md` | Explicit WordPress graph relationship contracts, rewrite limits, and fail-closed surfaces. |
| `docs/playground-topology.md` | Playground site roles, REST routes, and topology behavior. |
| `docs/scenario-matrix.md` | Current coverage map and known missing scenario families. |
| `docs/generated-push-harness.md` | Generated harness tiers, counts, and invariants. |
| `docs/operations/operator-runbook.md` | Operator checks, rollout expectations, and recovery posture. |
| `docs/supervised-lanes.md` | Parallel worktree, tmux lane, feedback, and progress-publishing workflow. |
| `docs/release/go-no-go-release-decision-record.md` | Historical release decision records. Verify against fresh evidence before using operationally. |
| `docs/evidence/` | Evidence notes and audit trails from previous proof slices. |
| `progress.html` | Human-readable progress page for the current proof state. |

## Development Principles

- Fail closed before mutation.
- Revalidate live source state at apply time.
- Preserve unplanned remote changes.
- Treat plugin-owned data as owned by its plugin until a driver proves
  otherwise.
- Keep release evidence useful without leaking private payloads.
- Prefer deterministic fixtures for narrow behavior and Docker topology for
  production-shaped proof.
- Use only local ingress and sandbox-approved port exposure for demos.

## Production Readiness Summary

Use this repository as a release-candidate proof and integration guide for a
constrained Reprint push path. The current Docker proof can pass as `GO` for the
modeled topology, and the safety model is ready for serious integration work.

Do not treat it as a turnkey production service until the remaining production
endpoint, auth, storage, backup, monitoring, and operator controls are supplied
by the surrounding Reprint deployment.
