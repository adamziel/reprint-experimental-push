# Critic Release Gate

This note is a compact checklist for any wording that might claim production-grade push support.

Do not use production wording unless the branch has all of the following for the same live mutation boundary on this worktree:

- the exact stale-drift case is named;
- the remote that drifted is preserved and still inspectable after rejection, and that preserved remote is audit evidence only until a fresh retry scope is rebuilt from live hashes;
- the stale approval or review artifact is rejected before the first write and cannot become retry authority;
- any stale manual-review artifact remains audit-only after drift and cannot be reused against a different row, file, relationship-bearing record, remapped create target, or plugin-owned surface;
- any stale manual-review artifact cannot become retry authority for a later-discovered plugin-owned surface that appears only after the first write, even if the later surface looks like the earlier one;
- the fresh retry artifact is rebuilt from live hashes on this branch, not inherited from the earlier approval;
- every touched row, file, relationship-bearing record, and plugin-owned surface is classified as old, new, or blocked before retry starts;
- any late-discovered plugin-owned surface is separately blocked or classified, not folded into the earlier success story;
- any partial file, DB, or plugin side effect is durably classified before retry so a mixed write cannot be relabeled as success; and
- any manual-resolution note, route-shaped smoke, fixture replay, or `finalMatchesLocal` result is treated as compatibility evidence only unless it is paired with the preserved remote, the rejection point, the stale-artifact rejection, the fresh retry artifact rebuilt from live hashes, and the same live boundary on this worktree;
- any source-note comparison to Reprint, ZS-Sync, or ForkPress is historical context only unless it names the exact upstream revision or worktree state, says what the note proves here, says what it does not prove here, and the same live boundary was rerun on this branch; the note still cannot become current retry authority without preserved-remote evidence and a fresh live-hash retry scope;
- any source-note comparison that merely matches the same route family, package layout, or reviewer wording is still historical context only and cannot be treated as live proof of retry authority, preserved-remote safety, or stale-authority rejection; and
- any claim of "production-grade push support" is rejected unless the same live boundary shows preserved-remote evidence, stale-authority rejection, fresh retry scope rebuilt from live hashes, and per-surface old/new/blocked classification; and
- any late-discovered plugin-owned surface that appears only after the first write is treated as a new boundary until it is separately rejected or classified, with its own preserved remote and fresh retry scope; and
- any partial file, DB, or plugin side effect is classified before retry so mixed writes cannot be relabeled as success; and
- any claim that "manual resolution" succeeded without the preserved remote, the rejection point, and a fresh retry artifact rebuilt from live hashes for the same live boundary is false reliability, not success.
- any claim that "manual resolution" succeeded is also false reliability if the first write committed but a later plugin-owned surface was discovered afterwards and never got its own preserve/reject/retry cycle.
- proof for one live boundary is not transferable to a later boundary, even if
  the route family, package mount, fixture replay, or reviewer wording is the
  same; the later row, file, relationship-bearing record, remapped create
  target, or plugin-owned surface still needs its own preserved remote,
  rejection point, and fresh retry artifact rebuilt from live hashes.

False success to reject:

- "manual resolution later" is not success if the readable artifact is still
  being reused as authority after drift, or if the later boundary never got
  its own preserve/reject/retry cycle on this worktree;
- "comparison passed" is not success if the source note lacks the exact
  upstream revision or worktree state, the same live boundary, and an explicit
  statement of what it does not prove here;
- "production-grade push support" is not success if the only proof is route
  shape, package mount shape, fixture replay, a readable review artifact, or
  `finalMatchesLocal`, because none of those prove stale authority was rejected
  before mutation; and
- "plugin-safe" is not success if any late-discovered plugin-owned surface was
  folded into the first approval instead of being separately enumerated or
  blocked with its own preserved remote and retry scope.
- "source-note proof" is not success if the note only matches the same route
  family, package layout, or reviewer wording; shape similarity is not live
  proof of preserved-remote safety, stale-artifact rejection, or retry
  authority on this branch.

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
- plugin-owned state outside the allowlist, including hidden tables, cron rows, runtime registries, generated files, serialized blobs, caches, and plugin-owned files, especially when the live surface is only discovered after the first write;
- stale manual-review artifacts that remain readable after drift and could be reused against a different boundary, remapped create target, or plugin-owned surface;
- late-discovered plugin-owned surfaces that appear only after the first write and are then folded into the earlier approval without a separate reject/classify/retry cycle; and
- partial file, DB, or plugin side effects that are relabeled as success without old/new/blocked classification for every touched surface, including the case where the first write succeeded but the later retry boundary did not.

Release wording must also avoid implying that a readable review artifact or comparison note is equivalent to a live retry gate. Those artifacts are audit evidence only until the branch shows the preserved remote, rejection point, and fresh retry scope for the same boundary on this worktree. Manual resolution is not success unless the remote is preserved for audit, the stale artifact stays unusable as retry authority, and the fresh retry artifact is recorded separately on this branch.

Anti-trap wording:

- a lab-shaped route, packaged mount, fixture replay, or `finalMatchesLocal` result can still come from a copied or fixture-backed executor behind the same URL shape, so it is compatibility evidence only and never proof that the live write boundary was production-safe;
- a readable review artifact can prove auditability, but it does not prove the remote was preserved, that stale authority was rejected before mutation, or that retry scope was rebuilt from fresh live hashes on this branch;
- a source-note comparison to Reprint, ZS-Sync, or ForkPress is historical context only unless the exact upstream revision or worktree state is named and the same live boundary was rerun here; and
- any later-discovered plugin-owned surface is a new boundary, not a continuation of the first write, until this branch shows its own preserve / reject / retry cycle.

Production-readiness language checklist:

- name the exact live boundary and the exact stale-drift case;
- show the preserved remote stayed auditable after rejection;
- show the stale approval, review artifact, or comparison note was rejected before mutation and cannot widen to a different row, file, relationship-bearing record, remapped create target, or plugin-owned surface;
- show the fresh retry artifact was rebuilt from live hashes on this branch, not inherited from earlier approval or copied from a note;
- show the exact live boundary was rerun here, not just a matching route shape or package mount;
- classify every touched surface as old, new, or blocked before retry starts;
- enumerate or block every plugin-owned surface outside the allowlist, including late-discovered tables, files, cron rows, runtime registries, serialized blobs, caches, and generated assets;
- treat route shape, package mount shape, fixture replay, readable review output, and `finalMatchesLocal` as compatibility evidence only; and
- name the exact upstream revision or worktree state for any Reprint, ZS-Sync, or ForkPress comparison, plus what that note proves here and what it does not prove.
