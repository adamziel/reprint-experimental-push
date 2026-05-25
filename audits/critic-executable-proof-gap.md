# Executable Proof Gap

This note records the gap that still blocks production-grade push wording on
this branch.

Primary finding:

- the current baseline is reliable-executor commit `3089aee2`, and
  `npm run verify:release` is material retained-source evidence only. It is
  still lab evidence until a rerunnable real-site command proves the live
  WordPress auth/session boundary, preserved-remote auditability, apply-time
  revalidation, and journal/recovery inspection on a real local, Playground,
  or Docker `REPRINT_PUSH_SOURCE_URL`. The blocker is no longer "there is no
  verify:release command"; the blocker is that no available command yet
  proves the live boundary on an actual remote. Until one exact executable
  release command can be rerun on demand and capture the first real
  executor/auth/preserved-remote boundary, any production-grade push wording
  is false reliability and must fail closed. The next acceptable proof must
  move from local retained-source evidence to production WordPress
  auth/session lifecycle, durable journal, and lease/fencing semantics, with
  graph identity and plugin-driver coverage made explicit on that same live
  boundary;

Supporting failures:

- route-shaped smokes, fixture replays, and readable manual-resolution notes
  can support compatibility or audit claims, but they do not prove preserved
  remote retention, stale-drift rejection before the first write, or retry
  scope rebuilt from live hashes;
- a completed `npm run verify:release` run is still not production proof
  unless the same rerun also shows the live WordPress auth/session lifecycle,
  durable journal semantics, lease/fencing semantics, graph identity,
  plugin-driver coverage, and the
  preserved remote on a real local, Playground, or Docker
  `REPRINT_PUSH_SOURCE_URL`;
- stale manual-review artifacts and older comparison notes stay audit evidence
  only unless the same live boundary was rerun here and the artifact names the
  preserved remote, rejection point, and fresh retry scope for that exact
  boundary;
- a comparison note that names an upstream commit or worktree state is
  historical context only unless the same live boundary is rerun on this
  branch, the preserved remote remains inspectable after rejection, and the
  fresh retry scope is rebuilt from live hashes on this worktree; that note
  still does not prove preserved-remote safety, production auth/session
  lifecycle, recovery-journal durability, graph identity, or plugin-driver
  coverage here;
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
