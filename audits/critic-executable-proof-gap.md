# Executable Proof Gap

This note records the gap that still blocks production-grade push wording on
this branch.

Primary finding:

- the repo has provenance material for Reprint, ZS-Sync, and ForkPress, but it
  still lacks a single branch-local executable real-site preflight/release
  command that proves the live boundary end to end on an actual remote. The
  existing `plan`, `apply`, and `test:playground:*` commands are lab or
  compatibility surfaces only, and the current production-shaped smoke still
  advertises `labBacked: true`. Until a named real-site release command exists
  and can be rerun on an actual remote with a real `REPRINT_PUSH_SOURCE_URL`
  target, live preflight evidence, and the first real executor/auth/
  preserved-remote boundary recorded, any production-grade push wording is
  false reliability and must fail closed; docs-only or lab-only success
  claims are not enough;

Supporting failures:

- route-shaped smokes, fixture replays, and readable manual-resolution notes
  can support compatibility or audit claims, but they do not prove preserved
  remote retention, stale-drift rejection before the first write, or retry
  scope rebuilt from live hashes;
- a comparison note that names an upstream commit or worktree state is
  historical context only unless the same live boundary is rerun on this
  branch, the preserved remote remains inspectable after rejection, and the
  fresh retry scope is rebuilt from live hashes on this worktree;
- manual resolution is not a success label unless the same live boundary
  preserved the remote, rejected stale authority before the first write, and
  rebuilt retry scope from live hashes for the exact boundary that drifted; and
- any later-discovered plugin-owned surface or remapped create target needs its
  own preserve / reject / retry cycle instead of inheriting a prior readable
  artifact, even if the route family or review wording matches.

Required changes before production-grade push support can be claimed:

- add a named executable preflight/release command for real-site use, not just
  lab or playground compatibility flows, and make it accept a real
  `REPRINT_PUSH_SOURCE_URL` rather than a fixture-only target;
- make that command prove the exact rejection point, preserved remote, fresh
  retry scope, executor/auth lifecycle, and boundary-specific live boundary
  identity on the actual remote;
- classify every touched row, file, relationship-bearing record, and
  plugin-owned surface as old, new, or blocked before retry starts; and
- ensure later-discovered plugin-owned surfaces or remapped create targets get
  their own preserve / reject / retry cycle instead of inheriting an earlier
  readable artifact.
