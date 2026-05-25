# Critic Production Checklist

Use this checklist before any wording claims production-grade push support on
this branch.

- The exact live boundary is named, along with the exact stale-drift case.
- The same live boundary preserves the rejected remote and leaves it
  inspectable after rejection.
- Stale authority is rejected before the first write.
- Dry-run receipt and apply-time revalidation are shown on the same live
  boundary.
- Journal and recovery state are inspected so retry scope is auditable.
- Every touched row, file, relationship-bearing record, and plugin-owned
  surface is classified old, new, or blocked before retry starts.
- Every plugin-owned surface outside the allowlist is enumerated or blocked
  before write, including hidden tables, cron rows, runtime registries,
  generated files, caches, serialized blobs, and plugin-owned files.
- Any later-discovered plugin-owned surface, remapped create target, or mixed
  file/DB/plugin side effect is treated as a separate live boundary unless it
  already had its own preserve / reject / retry cycle before the first write.
- Each Reprint, ZS-Sync, and ForkPress comparison names the exact upstream
  revision or worktree state, states what it proves here, states what it does
  not prove here, and is backed by a branch-local rerun of the same live
  boundary.
- The claim identifies its evidence class as historical context,
  compatibility evidence, or live retry proof.
- The claim does not use "comparison passed", "manual resolution succeeded",
  or "production-ready" unless the preserved remote, rejection point, and
  fresh retry scope are all present in the same rerun.
