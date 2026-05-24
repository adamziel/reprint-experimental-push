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
and upload files with stable fixture markers. They are intentionally small
because this topology proves snapshot extraction and planning, not the final
transport.

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
- apply with a supplied dry-run receipt applies the five expected fixture
  mutations and verifies the resulting hashes and WordPress-visible surface;
- stale apply against the changed remote fixture fails with
  `PRECONDITION_FAILED` and preserves the drifted remote state;
- conflict dry-run and conflict apply refuse with `PLAN_NOT_READY` and include
  audit evidence for row, file, and plugin-data conflict classes.

The smoke uses a prior dry-run receipt for the ready apply path, but that is not
yet a protocol guarantee. The current PHP lab endpoint still permits apply
without a supplied receipt by creating one inline.

## Next Proofs Needed

- Replace the fixture-scoped PHP lab endpoint with a real Reprint push HTTP
  endpoint, authentication, sessions, and source-site capability checks.
- Revalidate live remote hashes immediately before production apply.
- Add production enforcement for prior dry-run receipts, with expiry and binding
  to the accepted remote snapshot.
