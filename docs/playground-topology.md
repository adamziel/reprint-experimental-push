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

The blueprints use `runPHP` to create WordPress posts/options with stable
fixture markers. They are intentionally small because the first goal is to
prove topology bootstrapping, not the final transport.

## Smoke Command

```bash
scripts/playground/smoke-blueprints.sh
```

The script runs each blueprint with:

```bash
npx --yes @wp-playground/cli@latest run-blueprint --blueprint=<file>
```

It does not start a server. Future executor tests can build from the same
fixtures by adding mounted Reprint plugins, source snapshot export, local edit
capture, and guarded push apply.

## Next Proofs Needed

- Mount the Reprint exporter/importer or experimental push plugin into the
  Playground runtime.
- Export base/local/remote snapshots from actual WordPress state instead of
  hand-authored JSON fixtures.
- Execute a push dry-run against the remote-changed Playground state.
- Revalidate live remote hashes immediately before apply.
- Assert WordPress-visible content and options after apply.

