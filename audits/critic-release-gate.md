# Critic Release Gate

This note is a compact checklist for any wording that might claim production-grade push support.

Do not use production wording unless the branch has all of the following for the same live mutation boundary on this worktree:

- the exact stale-drift case is named;
- the remote that drifted is preserved and still inspectable after rejection;
- the stale approval or review artifact is rejected before the first write and cannot become retry authority;
- the fresh retry artifact is rebuilt from live hashes on this branch, not inherited from the earlier approval;
- every touched row, file, relationship-bearing record, and plugin-owned surface is classified as old, new, or blocked before retry starts;
- any late-discovered plugin-owned surface is separately blocked or classified, not folded into the earlier success story;
- any partial file, DB, or plugin side effect is durably classified before retry so a mixed write cannot be relabeled as success; and
- any manual-resolution note, route-shaped smoke, fixture replay, or `finalMatchesLocal` result is treated as compatibility evidence only unless it is paired with the preserved remote, the rejection point, and the fresh retry artifact for that same boundary.

Source-note comparisons are historical context unless the exact upstream revision or worktree state is named and this branch reran the same live boundary against the same drift case.

That means:

- Reprint notes can justify transport shape, resumability vocabulary, or staged delivery framing, but not live push safety;
- ZS-Sync notes can justify discovery and cursoring shape, but not source-mutation safety; and
- ForkPress notes can justify review vocabulary and durability intent, but not retry authority for this branch.

If any production claim depends only on route shape, package mount shape, fixture replay, readable review output, or `finalMatchesLocal`, the claim must fail closed.

Concrete failure modes that still block the claim:

- live remote drift after dry-run but before apply;
- create-time identity remapping, aliasing, or renumbering;
- plugin-owned state outside the allowlist, including hidden tables, cron rows, runtime registries, generated files, serialized blobs, caches, and plugin-owned files; and
- stale manual-review artifacts that remain readable after drift and could be reused against a different boundary.
