# Critic Production Checklist

Use this checklist before any wording claims production-grade push support on
this branch.

- The exact live boundary is named, along with the exact stale-drift case.
- The same live boundary preserves the rejected remote and leaves it
  inspectable after rejection.
- A named real-site release command exists and can be rerun unchanged against
  that same live boundary.
- Stale authority is rejected before the first write.
- Dry-run receipt and apply-time revalidation are shown on the same live
  boundary.
- Journal and recovery state are inspected so retry scope is auditable.
- Hidden data-loss modes are explicitly covered: identity remaps on create,
  aliasing, renumbering, partial file writes, partial DB writes, partial
  plugin writes, and late-discovered plugin-owned surfaces cannot be
  backfilled into an earlier approval.
- The proof shows the exact boundary between known plugin-owned surfaces and
  blocked surfaces, including hidden tables, cron rows, runtime registries,
  generated files, caches, serialized blobs, and plugin-owned files that are
  outside the allowlist.
- If a later-discovered plugin-owned surface, remapped create target, or
  mixed file/DB/plugin side effect appears after the first write, the branch
  records it as a new live boundary with its own preserve / reject / retry
  cycle rather than treating manual resolution as success.
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
- Reprint comparisons are limited to transport and staged-delivery lineage;
  ZS-Sync comparisons are limited to discovery, scanning, and batching
  lineage; ForkPress comparisons are limited to merge-audit and crash-
  consistency lineage.
- None of those comparisons prove preserved-remote safety, stale-drift
  rejection before the first write, apply-time revalidation, durable journal
  semantics, graph identity, plugin-driver coverage, or retry authority on
  this branch unless the same live boundary was rerun here.
- The claim identifies its evidence class as historical context,
  compatibility evidence, or live retry proof.
- The claim does not use "comparison passed", "manual resolution succeeded",
  "production-ready", or "release-ready" unless the preserved remote,
  rejection point, and fresh retry scope are all present in the same rerun.
- If the claim only has a lab, fixture, or wrapper command, it must say so
  explicitly and cannot be treated as release evidence.
