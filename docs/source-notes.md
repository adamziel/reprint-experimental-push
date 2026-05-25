# Source Notes

These notes anchor the push-back design in existing work instead of starting
from scratch. They are historical design input, not current proof of
production push safety.

## Reprint

Repository: <https://github.com/adamziel/reprint>

Observed commit locally: `27c5f25 Speed up SQLite prepared insert builder (#249)`.

Relevant evidence:

- `packages/reprint-importer/src/lib/pull/class-pull.php` composes the pull
  pipeline as preflight, files pull, database pull, database apply, flat
  document root, runtime apply, and optional start.
- Pull is resumable and stage-oriented. Completed pulls prepare for a delta
  re-pull rather than treating the old completed state as immutable.
- `packages/reprint-exporter/src/export.php` exposes a streaming export API,
  protocol versioning, resource budgets, multipart streaming, and database/file
  helpers.

Design implication for push: keep the transport resumable and chunked, but do
not mirror pull blindly. Push mutates the source, so each chunk needs a compare
precondition, rollback story, and audit record. This is a design requirement,
not proof that any live mutation boundary is already safe. The Reprint pull
pipeline does not prove this branch rejects stale remote drift before the first
write, preserves the remote for audit, classifies later-discovered plugin-owned
surfaces, or handles create-time identity remap at apply time.

## ZS-Sync

Repository: <https://github.com/adamziel/zs-sync>

Observed commit locally: `d9334a0 Scan now on both sites`.

Relevant evidence:

- `lib/scanners/class.zs-sync-continuous-scanner.php` composes scanners and
  maintains cursors for continuous rescans.
- `lib/providers/class.zs-sync-resource-provider.php` lists changed resources
  by metadata tables and fetches selected file/database resources in bounded
  batches.
- The README frames site A as authoritative while B/C/D pull changes from it.

Design implication for push: ZS-Sync's scanner/resource model is useful for
detecting what changed since the pull base, but Reprint push needs source-site
mutation and conflict policy. The scanner is input to planning, not the whole
push solution. It does not prove stale-authority rejection, live remote-drift
handling, create-time remap safety, plugin-owned surface enumeration, or
partial-side-effect classification on this branch.

## ForkPress

Repository: <https://github.com/Automattic/forkpress>

Observed local worktree: `55f9879 Detect mount-backed remote clone boot deps`.

Relevant evidence:

- `docs/remote-sites.md` documents Reprint-backed HTTP remote clone as a thin
  clone path when SSH is unavailable.
- `docs/merging.md` describes three-way branch merge across WordPress files and
  SQLite data, conflict audit records, reviewed resolutions, and revalidation.
- `docs/plugin-merge-validators.md` treats plugin-specific semantics as a
  validator/driver boundary rather than something generic row merge should
  invent.
- `docs/merge-crash-consistency.md` defines the reliability target: after
  failure, the system must know whether the target is old, new, or blocked with
  recovery artifacts; it must not silently report success after a partial merge.

Design implication for push: ForkPress has the strongest source-note model for
merge auditability and crash consistency. Reprint push should borrow the
invariants, not necessarily the full COW branch runtime. That comparison is
still historical unless the exact upstream state and the live mutation
boundary were reverified here. It does not prove the live executor, preserved
remote retention after rejection, stale-review rejection, or manual-resolution
safety for a later boundary on this branch.

## Comparison Boundaries

Use the source notes only as design input:

- Reprint proves staged pull delivery, resumability vocabulary, and transport
  framing in the observed upstream commit. It does not prove live push safety,
  stale remote drift rejection, preserved-remote auditability, or create-time
  identity remapping on this branch.
- ZS-Sync proves bounded scanning, resource discovery, and batching ideas in
  the observed upstream commit. It does not prove source mutation safety,
  late-discovered plugin-owned surface coverage, or partial-write recovery on
  this branch.
- ForkPress proves audit vocabulary, merge-review framing, and crash
  consistency intent in the observed upstream commit. It does not prove the
  live executor, retry authority, or that a readable manual-review artifact can
  safely authorize a different row, file, relationship-bearing record,
  remapped create target, or plugin-owned surface on this branch.
