# Playground Test Topology

Docker and WP-CLI are not available in the current sandbox. The first real
WordPress topology therefore uses WordPress Playground CLI in no-server mode.
This avoids opening any local network ports and keeps the test state disposable.

## Sites

| Site | Blueprint | Purpose |
| --- | --- | --- |
| Remote base | `fixtures/playground/remote-base.blueprint.json` | Represents the source site at pull time. |
| Local edited | `fixtures/playground/local-edited.blueprint.json` | Represents the pulled local site after local edits. |
| Remote changed | `fixtures/playground/remote-changed.blueprint.json` | Represents the live source site after independent remote edits. |

The blueprints use `runPHP` to create WordPress posts, plugin-owned options,
fixture-marked plugin-owned postmeta, detection-only plugin-owned custom-table
rows, plugin metadata, and upload files with stable fixture markers. The
plugin-owned forms fixture covers the `reprint_push_forms_fixture` option,
`_reprint_push_forms_schema` postmeta, `wp_reprint_push_forms_lab` custom-table
rows, and `reprint-push-forms-fixture` plugin metadata. They are intentionally
small because this topology proves snapshot extraction and planning, not the
final transport.

## Smoke Command

```bash
scripts/playground/smoke-blueprints.sh
```

The script runs each blueprint with:

```bash
npx --yes @wp-playground/cli@latest run-blueprint --blueprint=<file>
```

It does not start a server.

## Playground Harness Command

```bash
npm run test:playground
```

The script mounts this repository into each Playground runtime, runs
`scripts/playground/export-site-snapshot.php`, passes the exported WordPress
posts/options/files through the JSON push planner, applies a ready fixture plan,
and runs a fixture-scoped protocol smoke. It currently asserts:

- the shared post is a real WordPress row conflict;
- the shared upload file is a file conflict;
- the `reprint_push_plugin_payload` option is a plugin-data conflict;
- the nested `reprint_push_forms_fixture` option is treated as allowlisted
  plugin-owned fixture data;
- `_reprint_push_forms_schema` postmeta is exported only for fixture-marked
  parent posts;
- `wp_reprint_push_forms_lab` rows and `reprint-push-forms-fixture` plugin
  metadata are detected but not applied;
- unknown plugin-owned custom-table rows block as
  `unsupported-plugin-owned-resource`;
- local-only post and file resources become guarded mutations;
- remote-only post and file resources are preserved as remote decisions.

## Guarded Apply Harness

The apply leg for `npm run test:playground` uses the same no-server Playground
boundary. It:

- exports real WordPress snapshots from the base, local edited, and remote
  changed fixtures;
- keeps the conflict-planning assertions above;
- builds a separate ready plan with `remote=base`, so local-only mutations are
  safe to apply against an unchanged source fixture;
- applies that ready plan inside a fresh Playground source site; and
- verifies the result through WordPress-visible posts, options, and files, not by
  trusting only the JSON applicator output.

The guarantee is intentionally narrow: the harness proves that guarded lab
mutations derived from real Playground snapshots can be applied to a disposable
Playground source and read back through WordPress. It does not prove the
production Reprint HTTP transport, a live source-site mutation endpoint,
durable remote journaling, authentication, or plugin-specific semantic merge
drivers.

## Fixture-Scoped Protocol Smoke

`scripts/playground/push-protocol-smoke.mjs` mounts
`scripts/playground/push-remote-endpoint.php` and
`scripts/playground/push-remote-lib.php` into no-server Playground runtimes.
This endpoint is intentionally lab-only and fixture-scoped. It is not the
production Reprint HTTP mutation endpoint.

The smoke verifies:

- dry-run validates all ready-plan mutation preconditions and reports
  `applied: 0`;
- same-process WordPress readback proves dry-run leaves the source fixture
  unchanged;
- apply with a supplied dry-run receipt applies the eight expected fixture
  mutations and verifies the resulting hashes and WordPress-visible surface;
- apply without a supplied receipt fails with `MISSING_DRY_RUN_RECEIPT` before
  mutation;
- tampered receipts fail with `RECEIPT_MISMATCH` before mutation;
- stale apply against the changed remote fixture fails with
  `PRECONDITION_FAILED` and preserves the drifted remote state;
- conflict dry-run and conflict apply refuse with `PLAN_NOT_READY` and include
  audit evidence for row, file, and plugin-data conflict classes.

The lab receipt is bound to the plan fingerprint/hash, mutation and
precondition sets, ordered resource keys, and dry-run actual hashes. The
endpoint also records bounded fixture-scoped lab journal/audit option events:
`dry-run-recorded`, `apply-started`, `apply-committed`,
`precondition-failed`, `plan-not-ready`, `receipt-required`, and
`receipt-mismatch`. These records are lab audit evidence only, not durable
production journals.

## Local-Only REST Lab Harness

```bash
npm run test:playground:http-push
```

This standalone script starts disposable WordPress Playground servers bound
only to `127.0.0.1` and talks to them over real HTTP. It is not included in
`npm run test:playground` because it takes around two minutes and starts real
servers.

The lab REST surface is mounted under the namespace `reprint-push-lab/v1` with:

- `GET /snapshot`
- `GET /journal`
- `POST /dry-run`
- `POST /apply`

The HTTP-style harness verifies namespace discovery, snapshot export, journal
readback, read-only dry-run, `MISSING_DRY_RUN_RECEIPT` before mutation when a
receipt is missing, dry-run receipt creation, ready apply success with eight
fixture mutations, `RECEIPT_MISMATCH` before mutation when the receipt is
tampered, stale remote refusal with `PRECONDITION_FAILED`, and conflict refusal
with `PLAN_NOT_READY` for row, file, and plugin-data classes.

This is stronger protocol-shape evidence than the no-server smoke because it
uses real local HTTP against disposable Playground servers. It remains
lab-only and fixture-scoped: the REST plugin is public only inside the local
Playground runtime, and it does not prove production auth, sessions, nonce
checks, signed receipts, durable journals, crash recovery, or live source-site
mutation safety.

## Next Proofs Needed

- Replace the fixture-scoped PHP lab endpoint with a real Reprint push HTTP
  endpoint, authentication, sessions, and source-site capability checks.
- Revalidate live remote hashes immediately before production apply.
- Add production-grade receipt expiry, signing/auth binding, and durable audit
  storage around the accepted remote snapshot.
- Add real plugin activation, custom-table driver, recovery, and auth proof
  before making claims about arbitrary production plugin-owned data.
