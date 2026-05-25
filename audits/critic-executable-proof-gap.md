# Executable Proof Gap

This note records the gap that still blocks production-grade push wording on
this branch.

Finding:

- the repo has provenance material for Reprint, ZS-Sync, and ForkPress, but it
  still lacks a single branch-local executable real-site preflight/release
  command that proves the live boundary end to end on an actual remote. Until
  that command exists, any production-grade push wording is false reliability
  and must fail closed;
- route-shaped smokes, fixture replays, and readable manual-resolution notes
  can support compatibility or audit claims, but they do not prove preserved
  remote retention, stale-drift rejection before the first write, or retry
  scope rebuilt from live hashes; and
- a comparison note that names an upstream commit or worktree state is
  historical context only unless the same live boundary is rerun on this
  branch, the preserved remote remains inspectable after rejection, and the
  fresh retry scope is rebuilt from live hashes on this worktree.

Required changes before production-grade push support can be claimed:

- add a named executable preflight/release command for real-site use;
- make that command prove the exact rejection point, preserved remote, and
  fresh retry scope on the live boundary;
- classify every touched row, file, relationship-bearing record, and
  plugin-owned surface as old, new, or blocked before retry starts; and
- ensure later-discovered plugin-owned surfaces or remapped create targets get
  their own preserve / reject / retry cycle instead of inheriting an earlier
  readable artifact.
