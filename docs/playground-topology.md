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

## Snapshot Planning Command

```bash
npm run test:playground
```

The script mounts this repository into each Playground runtime, runs
`scripts/playground/export-site-snapshot.php`, and passes the exported
WordPress posts/options/files through the JSON push planner. It currently
asserts:

- the shared post is a real WordPress row conflict;
- the shared upload file is a file conflict;
- the `reprint_push_plugin_payload` option is a plugin-data conflict;
- local-only post and file resources become guarded mutations;
- remote-only post and file resources are preserved as remote decisions.

## Next Proofs Needed

- Mount the Reprint exporter/importer or experimental push plugin into the
  Playground runtime.
- Execute a push dry-run through a Reprint HTTP endpoint rather than an in-process
  Node planner.
- Revalidate live remote hashes immediately before apply.
- Assert WordPress-visible content and options after apply.
