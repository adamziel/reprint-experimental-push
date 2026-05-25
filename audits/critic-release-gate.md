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
- any manual-resolution note, route-shaped smoke, fixture replay, or `finalMatchesLocal` result is treated as compatibility evidence only unless it is paired with the preserved remote, the rejection point, and the fresh retry artifact for that same boundary;
- any late-discovered plugin-owned surface that appears only after the first write is treated as a new boundary until it is separately rejected or classified, with its own preserved remote and fresh retry scope; and
- any partial file, DB, or plugin side effect is classified before retry so mixed writes cannot be relabeled as success.

Source-note comparisons are historical context unless the exact upstream revision or worktree state is named and this branch reran the same live boundary against the same drift case. A named Reprint, ZS-Sync, or ForkPress note can justify historical transport, discovery, or review vocabulary, but it does not prove the live executor, the preserved remote, or retry safety on this branch.

That means:

- Reprint notes can justify transport shape, resumability vocabulary, or staged delivery framing, but not live push safety;
- ZS-Sync notes can justify discovery and cursoring shape, but not source-mutation safety; and
- ForkPress notes can justify review vocabulary and durability intent, but not retry authority for this branch.

Even when the upstream state is named precisely, the comparison still does not prove this branch preserved the remote, rejected stale authority before mutation, or rebuilt retry scope from fresh live hashes. At best it proves that the cited note is a valid historical reference point for the same family of ideas.

If any production claim depends only on route shape, package mount shape, fixture replay, readable review output, or `finalMatchesLocal`, the claim must fail closed. Those are compatibility signals, not proof that the live mutation path rejected stale authority before the first write.

Concrete failure modes that still block the claim:

- live remote drift after dry-run but before apply;
- create-time identity remapping, aliasing, or renumbering;
- plugin-owned state outside the allowlist, including hidden tables, cron rows, runtime registries, generated files, serialized blobs, caches, and plugin-owned files; and
- stale manual-review artifacts that remain readable after drift and could be reused against a different boundary;
- late-discovered plugin-owned surfaces that appear only after the first write and are then folded into the earlier approval without a separate reject/classify/retry cycle; and
- partial file, DB, or plugin side effects that are relabeled as success without old/new/blocked classification for every touched surface.

Release wording must also avoid implying that a readable review artifact or comparison note is equivalent to a live retry gate. Those artifacts are audit evidence only until the branch shows the preserved remote, rejection point, and fresh retry scope for the same boundary on this worktree. Manual resolution is not success unless the remote is preserved for audit, the stale artifact stays unusable as retry authority, and the fresh retry artifact is recorded separately on this branch.
