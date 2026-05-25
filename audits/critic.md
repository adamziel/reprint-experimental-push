# Critic Audit

Current baseline for this critique: the current remote supervised reliable-
executor lane head `e7de778c` on `origin/lane/reliable-executor`, extending the
retained-source evidence anchored at `63a3502f` and the explicit verdict
`PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`. The remote lane now proves a
retained-source `npm run verify:release` lineage, durable-journal proof folded
into that verify path, a broader command-topology proof, and the lab-session
details `authSessionType`, minted session shape, `applyCommitted`, and
`durableJournal.rows: 17`. That retires any stale claim that there is no
retained-source `verify:release` evidence. It still does not prove a live
production boundary because this branch lacks preserved-remote retention after
rejection, apply-time revalidation against fresh live hashes, production
WordPress auth/session lifecycle, durable journal storage with lease/fencing
outside the Playground harness, graph identity under remap, and plugin-driver
coverage for late-discovered plugin-owned surfaces. Production wording is
false if it treats lab-session shape, retained-source journal rows, route
compatibility, or command-topology proof as a substitute for a rerunnable live
mutation boundary on this branch.

Source-note comparison, kept conservative and non-authoritative unless this branch reran the same live boundary:

- Reprint proves the intended push surface, compare-and-swap framing, and
  replayable protocol shape, but it does not prove a live production
  WordPress auth/session lifecycle, preserved-remote recovery, or durable
  journal semantics on this branch.
- ZS-Sync proves scanner and batching value, but not source mutation safety on
  its own; it does not close the atomicity, identity remap, lease/fencing, or
  plugin-owned surface traps that this project must prove before push can be
  called production-grade here.
- ForkPress contributes the strongest audit and crash-recovery story, but the
  source notes still do not supply proof for this branch's required live
  WordPress boundary, durable storage, preserved-remote retry, or
  plugin-driver coverage for late-discovered plugin-owned surfaces on a
  rerunnable live mutation.

The latest remote evidence is strong enough to retire stale "no
`verify:release` exists" critiques on this audit branch. It is not strong
enough to unlock production wording, because no rerunnable live boundary on a
real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` has yet proven
preserved-remote retention after rejection, apply-time revalidation from
fresh live hashes, production auth/session lifecycle, durable journal storage
with lease/fencing, graph identity, and plugin-driver coverage on the same
mutation. Until one command can be rerun here and still show the rejected
remote preserved for audit, retry, and later inspection, the rest of the
evidence remains lab progress.

Next proof required: one rerunnable live command on a real local, Playground,
or Docker `REPRINT_PUSH_SOURCE_URL` that rejects stale drift before the first
write, preserves the remote after rejection, revalidates at apply time from
fresh live hashes, and records journal/recovery, graph identity, plugin-driver
coverage, and auth/session lifecycle on the same mutation. Anything shorter is
still lab evidence, not production-grade push support.

Before the project can claim production-grade push support, the proof set
must include all of the following on one rerunnable live boundary:

- exact stale-drift rejection before the first write;
- preserved remote still inspectable after rejection;
- dry-run receipt and apply-time revalidation on the same mutation;
- journal and recovery inspection that survives retry;
- graph identity proof for create-time remaps and late-discovered
  relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces outside
  the initial allowlist; and
- auditable retry scope rebuilt from fresh live hashes rather than manual
  resolution text.

The critique target is therefore narrow: this worktree still lacks one
rerunnable live boundary on a real local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote, revalidates at
apply time, and proves production WordPress auth/session lifecycle, durable
journal storage and lease/fencing semantics outside the lab harness, graph
identity, plugin-driver coverage, and preserved-remote drift handling on the
same mutation. The supervised reliable-executor lane can provide material
retained-source evidence for those shapes, but that evidence is not enough to
claim production-grade push support here unless the same live boundary is
runnable on this branch and the rejected remote remains auditable and
retryable. If the only available proof is a retained-source or fixture replay,
the claim must stay at "lab progress" rather than "production-ready."

## Release Gate Checklist

Before any production-grade wording is allowed, one rerunnable live boundary
must show all of the following on the same mutation:

- preserved remote still inspectable after rejection;
- apply-time revalidation against fresh live hashes;
- production WordPress auth/session lifecycle;
- durable journal storage with lease/fencing semantics;
- graph identity across create-time remaps and relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces; and
- auditable retry scope that survives manual-review text without trusting it.

If any item is only shown in a retained-source replay, lab fixture, or route
shape smoke, the claim remains blocked.

## What must change before production-grade wording is defensible

Before the project can claim production-grade push support, the proof set
must include all of the following on one rerunnable live boundary:

- exact stale-drift rejection before the first write;
- preserved remote still inspectable after rejection;
- dry-run receipt and apply-time revalidation on the same mutation;
- journal and recovery inspection that survives retry;
- graph identity proof for create-time remaps and late-discovered
  relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces outside
  the initial allowlist; and
- auditable retry scope rebuilt from fresh live hashes rather than manual
  resolution text.

Manual resolution is not success unless the remote is preserved, the retry is
auditable from fresh live hashes, and the user can safely replay the exact
boundary without trusting stale review text.

## Hidden-loss scenarios that remain unproven

The current design still has hidden data-loss modes that are not closed by the
retained-source lab evidence:

- if drift appears after dry-run receipt but before apply, the remote must stay
  preserved and the mutation must fail closed; no proof shows that the rejected
  remote is still auditable after the failure;
- if create-time identity remaps during apply, the graph identity must stay
  stable across the remap or the retry is a new mutation; no proof shows that a
  remapped row, file, or relationship-bearing record can be traced back to the
  original preserved remote;
- if a plugin-owned surface is discovered after the initial allowlist, the
  system must classify it as blocked or retryable before any side effect lands;
  no proof shows late-discovered plugin data traps are surfaced before commit;
- if partial file, DB, and plugin side effects occur together, the recovery
  artifact must expose exactly which surfaces committed and which were blocked;
  no proof shows mixed-surface recovery can be audited without manual
  reconstruction; and
- if stale review text or a reminted session is reused, the retry must still
  point to the same preserved remote and not authorize a new mutation; no proof
  shows manual resolution is safe when the remote has drifted.

## Must-change proof gaps

Before production-grade push support can be claimed, the project still needs:

- one rerunnable live boundary against a real local, Playground, or Docker
  `REPRINT_PUSH_SOURCE_URL`, not just retained-source replay;
- production WordPress auth/session lifecycle proof on that same boundary;
- preserved-remote retention that stays inspectable after rejection and can be
  reused for audit and retry;
- apply-time revalidation on the same mutation after dry-run receipt, using
  fresh live hashes instead of manual resolution text;
- durable journal storage with lease/fencing semantics outside the Playground
  harness;
- graph identity proof for create-time remaps and late-discovered
  relationship-bearing records; and
- plugin-driver coverage for late-discovered plugin-owned surfaces outside the
  initial allowlist.

## Single strongest blocker

This worktree still has no rerunnable live boundary on a real local,
Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that proves preserved-remote
retention after rejection, fresh live-hash revalidation, production WordPress
auth/session lifecycle, durable journal storage with lease/fencing, graph
identity, and plugin-driver coverage on the same mutation. That is a
branch-local gap, not a project-wide absence: the supervised lane already has
`verify:release`, retained-source evidence, a durable-journal smoke, a broader
command-topology proof, and the explicit `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`
verdict, but this checkout does not yet expose the same live boundary.

The production claim is blocked until one rerunnable boundary here shows all of
the following on the same mutation:

- preserved remote still inspectable after rejection;
- apply-time revalidation against fresh live hashes;
- production WordPress auth/session lifecycle;
- durable journal storage with lease/fencing semantics;
- graph identity across create-time remaps and relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces; and
- auditable retry scope that survives manual-review text without trusting it.

Until that exact boundary exists here, production-grade push wording is false
reliability, even if the supervised lane has stronger retained-source evidence
and an explicit boundary verdict.

The next acceptable proof must be one rerunnable live command against a real
local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, with:

- the exact command string on this worktree;
- executor identity and live auth/session boundary before the first write;
- preserved remote still inspectable after rejection;
- exact rejection point before the first write;
- dry-run receipt;
- apply-time revalidation;
- journal/recovery inspection;
- graph identity;
- plugin-driver coverage; and
- old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface before retry starts.

Any claim that skips one of those receipts is not production-grade proof; it is
an unverified manual-resolution note.

Until that live boundary exists, `verify:release` is only retained-source lab
evidence, not proof that production WordPress push can safely preserve,
inspect, and retry a rejected remote on this branch.

## What improved in the supervised lane

The evidence improved, but only in the lab-harness sense, and only on the
current remote head:

- `verify:release` now exists in the remote lane and is exercised as a
  retained-source run rather than route-shape-only smoke.
- The lab evidence now names executor/session/journal details:
  `authSessionType`, minted session shape, `applyCommitted`, and
  `durableJournal.rows: 17`.
- The remote lane also added a durable-journal smoke, which strengthens the
  lab harness but still does not replace production storage, lease, or fencing
  proof.
- The boundary verdict is explicit instead of implicit, and the later remote
  head keeps that verdict current instead of stale.

That is real progress, but it still does not prove retry authority on this
branch. A retained-source replay is not the same as a live rerun that preserves
the rejected remote and revalidates apply-time behavior from fresh live hashes
on production WordPress auth/session state.

The Reprint, ZS-Sync, and ForkPress notes remain provenance only unless this
branch reran the same live boundary here. The observed anchors in
`docs/source-notes.md` are `27c5f25`, `d9334a0`, and `55f9879`; matching
route family, package layout, reviewer wording, or retained-source lab
behavior is not enough to promote those notes from design input to retry
authority, and none of them prove production WordPress auth/session
lifecycle, durable journal lease/fencing, graph identity, or plugin-driver
coverage on this branch.

## Release Gate Checklist

Production-grade push support can only be claimed after the project has all of
the following on the same live boundary:

- a named real-site release command that reruns unchanged against the same
  live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`;
- preserved-remote audit evidence that survives rejection and can be replayed
  for audit and retry;
- exact executor identity, auth/session lifecycle, and rejection point before
  the first write;
- dry-run receipt plus apply-time revalidation on the same live mutation;
- journal/recovery inspection that proves retry scope from fresh live hashes,
  durable storage, and lease/fencing behavior under retry on production
  WordPress state, not just retained-source lab state or Playground-only
  instrumentation;
- graph identity proof for create-time remaps and late-discovered
  relationship-bearing records;
- explicit old/new/blocked classification for touched rows, files,
  relationship-bearing records, and plugin-owned surfaces; and
- plugin-driver coverage for late-discovered plugin-owned data traps outside
  the allowlist, with explicit handling for plugin-owned state that is not
  visible in the initial plan; and
- a preserved-remote receipt that is still inspectable after rejection and
  lets a reviewer audit, retry, and compare the exact boundary without
  depending on manual resolution or stale review text.

Until those proofs exist on the same live boundary, any wording that says the
system is production-ready is a claim without audit-grade support. A retained-
source `verify:release` run, a lab session trace, or a reviewer note about the
same route family is not enough unless the preserved remote can still be
inspected after rejection and the exact boundary can be rerun from fresh live
hashes.

Any hidden-loss mode that is not proven there remains a blocker:

- remote drift after dry-run but before apply must be rejected without losing
  the original remote state, and retry scope must be rebuilt from fresh live
  hashes rather than manual judgment;
- drift discovered after dry-run receipt but before journal finalize must not
  turn a partial apply into success; if the recovery artifact cannot show
  which rows, files, relationships, and plugin-owned surfaces committed, the
  remote is still mixed and the mutation is blocked;
- stale auth/session reuse after identity or role drift must be proven safe
  only if the branch shows lease/fencing behavior; a preflight-minted session
  or refreshed credential that can still authorize a later apply against a
  changed remote is a replay-risk bug, not production proof;
- concurrent writer overlap, lease expiry, or fencing failure must be shown
  to fail closed before any irreversible write; otherwise a preserved remote
  can still be corrupted by two valid-looking writers racing the same target;
- create-time identity remaps must be proven at apply time, not assumed from
  route shape, fixture replay, or review wording;
- later-discovered plugin-owned surfaces, remapped create targets, and mixed
  file/DB/plugin side effects must get their own preserve / reject / retry
  cycle unless they were already enumerated before the first write; and
- stale manual-review artifacts must not authorize a later mutation if the
  remote has drifted, the session was reminted, or a plugin-owned surface was
  discovered after the note was written; the reviewer must be able to inspect
  the preserved remote and rerun the same live boundary, not trust the old
  approval text;
- graph identity must remain stable across dry-run, rejection, and retry;
  if the system cannot prove that the same logical object is still the same
  row, file, or relationship-bearing record after remap, the "retry" is a
  new mutation, not a safe continuation;
- mixed file, DB, and plugin side effects must be classified per surface
  before retry; a partially applied plugin option, cron row, file publish, or
  metadata rewrite cannot be relabeled as success just because the plan
  eventually converged;
- partial file, DB, and plugin side effects must never be reported as success
  without a preserved-remote receipt that lets a reviewer audit and retry the
  exact rejected boundary.
- a plugin-driver or allowlist gap discovered after preflight must be treated
  as a new preserve / reject / retry decision, not folded into an earlier
  manual resolution note.

Manual resolution is not success unless the remote is preserved, the retry is
auditable from fresh live hashes, and the user can safely replay the exact
boundary without trusting stale review text.

## What the source notes prove, and do not prove

The source notes are still useful, but only as design input and not as proof
that this branch is release-ready:

- Reprint `27c5f25` proves resumable pull transport and stage framing in the
  observed upstream commit; it does not prove live push safety, preserved-
  remote retention, or WordPress auth/session lifecycle on this branch.
- ZS-Sync `d9334a0` proves bounded discovery and cursoring in the observed
  upstream commit; it does not prove source mutation safety, plugin-owned
  surface coverage, or retry authority on this branch.
- ForkPress `55f9879` proves merge audit vocabulary and crash-consistency
  intent in the observed upstream commit; it does not prove this branch can
  preserve the rejected remote, classify plugin-owned side effects, or rerun
  the same live boundary with fresh live hashes.
- None of the source notes prove production auth/session lifecycle or durable
  journal semantics outside the Playground harness; they are design inputs,
  not release evidence.

Treat those notes as upstream context, not retry authority. If a later claim
borrows their vocabulary to imply a production boundary, it must still name
the branch-local live command, the preserved remote after rejection, and the
fresh-hash apply revalidation that this worktree has not yet shown.

Those notes are strongest when they are treated as input to the design, not as
evidence that the current branch already satisfies release gating. Route shape
similarity, package layout similarity, or a matching review phrase is not proof
of preserved-remote safety, and none of the three source notes prove a live
mutation on this branch with preserved-remote auditability, retry authority,
or production auth/session lifecycle.

## Why the latest remote lane still does not unlock release

The remote reliable-executor head now gives better lab evidence, not release
proof:

- `5822745b` and the retained-source point `63a3502f` keep the release
  boundary explicit and confirm the retained-source verifier path is still
  being tightened, but it still stays inside the supervised lane's lab
  harness.
- The latest explicit verdict, `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`,
  is the right release gate for this head; it keeps the boundary closed even
  with the improved retained-source handoff.
- The evidence still does not show a production WordPress auth/session
  lifecycle on a real source boundary.
- The evidence still does not show durable journal semantics outside the
  Playground harness or lease/fencing behavior against a live remote.
- The evidence still does not show graph identity across remap on the same
  live mutation.
- The evidence still does not show plugin-driver coverage for late-discovered
  plugin-owned surfaces outside the initial allowlist.

That means the next proof must be a live, rerunnable boundary with preserved-
remote retention and fresh live-hash revalidation, not another wording
adjustment on the retained-source lane.

## Release gate

Production-grade push support remains blocked until a rerunnable live boundary
on this branch proves, on the same mutation and with replayable preserved-
remote evidence:

- preserved-remote retention after rejection, with exact audit/retry evidence;
- production WordPress auth/session lifecycle, not just retained-source
  session shape;
- apply-time revalidation against a fresh live source hash set;
- durable journal semantics that survive outside the Playground harness;
- graph identity across create-time remaps and late-discovered records; and
- plugin-driver coverage for plugin-owned surfaces outside the initial
  allowlist.

## Must-change items

Before the project can claim production-grade push support, the design needs
all of the following to be explicit and exercised:

- preserved-remote retention that survives rejection and is still inspectable
  for audit and retry;
- a live auth/session lifecycle on production WordPress, not just a retained-
  source session shape;
- apply-time revalidation from fresh live hashes, with rejection before any
  irreversible write if drift appears;
- durable journal and recovery semantics outside the Playground harness,
  including lease/fencing proof under retry and concurrent writer pressure;
- graph identity proof for create-time remaps and late-discovered
  relationship-bearing records;
- plugin-driver coverage for plugin-owned surfaces that are not visible in the
  initial allowlist;
- explicit old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface; and
- a replayable live command and receipt trail that lets a reviewer audit the
  exact rejection, retry scope, and preserved remote without manual resolution.

The supervised reliable-executor lane's completed retained-source
`verify:release` run is now material evidence, including the explicit
`authSessionType`, minted session shape, `applyCommitted`, and
`durableJournal.rows: 17` details. That is useful lab progress, but it still
is not production proof for this branch until the same live boundary is rerun
here and the preserved remote remains auditable and retryable.

## Current verdict

The strongest blocker is still the missing rerunnable live boundary on this
branch. That is a branch-local gap, not a project-wide absence: the supervised
reliable-executor lane already gives stronger retained-source evidence, but
that evidence only upgrades the lab harness, not the release claim. Until
this branch can show preserved-remote auditability plus live auth/session,
journal, graph, and plugin-driver proof on the same mutation, production-
grade push support is not a defensible statement.

If a claim cites one of those notes as if it were production proof, it must be
rejected unless the claim also names the exact live boundary and the preserved
remote evidence from this branch.

## Source-note comparison

Source-note comparisons stay provenance only unless they name the exact
upstream state, state what each note proves here, state what it does not
prove here, and are backed by a rerun of the same live boundary on this
worktree. The observed anchors in `docs/source-notes.md` remain historical
context only:

- Reprint `27c5f25` explains staged transport and resumable-delivery framing;
  it does not prove preserved-remote safety, stale-drift rejection, or
  create-time remap safety on this branch.
- ZS-Sync `d9334a0` explains bounded discovery, resource selection, and
  cursoring; it does not prove source mutation safety, plugin-owned surface
  coverage, or retry authority here.
- ForkPress `55f9879` explains audit and crash-consistency vocabulary; it
  does not prove live remote preservation, durable journal semantics on this
  branch, leases/fencing, or later-surface preserve / reject / retry handling.
  It also does not prove that a preserved remote can be safely retried after a
  plugin-owned surface is discovered late.

The upstream anchors recorded in `docs/source-notes.md` remain provenance
only until this branch reruns the same live boundary and states what each note
proves here and what it does not prove here. Until then, they are useful for
design lineage, not for release claims.

The missing repo proof is not another provenance note. It is a rerunnable live
push boundary on this branch with preserved-remote retention, production
WordPress auth/session lifecycle, apply-time revalidation, durable journal
semantics outside Playground, graph identity, and plugin-driver coverage for
late-discovered plugin-owned surfaces on the same mutation.

Until that boundary exists, any statement that the project is
production-grade is overstating the evidence. The current evidence is still
consistent with a lab-only executor that can fail closed while leaving the
real remote and later plugin-owned surfaces unproven.

## Release-gate checklist

Before any production wording, the project must show:

- one exact executable command that reruns unchanged against the same live
  `REPRINT_PUSH_SOURCE_URL`;
- executor identity and auth/session boundary before the first write;
- preserved remote still inspectable after rejection;
- dry-run receipt plus apply-time revalidation on the same mutation;
- journal/recovery inspection showing retry scope rebuilt from fresh live
  hashes, with durable journal lease/fencing behavior proven outside
  Playground;
- graph identity coverage for create-time remaps and late-discovered surfaces;
- plugin-driver coverage for hidden plugin-owned data traps outside the
  allowlist; and
- old/new/blocked classification for each touched row, file,
  relationship-bearing record, and plugin-owned surface before retry starts.

## False-reliability cases that must fail closed

- a "manual resolution" note covers the first conflict, then a later
  plugin-owned table, cron row, generated file, cache entry, serialized blob,
  or remapped create target appears after the first write;
- a late-discovered plugin-owned data trap is silently folded into a prior
  approval because the first readable artifact still looks valid;
- a comparison note says Reprint, ZS-Sync, or ForkPress "covers" the branch
  because the route family or package mount looks similar, but it does not
  name the exact upstream state or the exact live boundary on this worktree;
- the supervised reliable-executor lane's retained-source `verify:release`
  result is treated as project evidence only, not as proof that this branch has
  its own rerunnable live boundary, preserved-remote retry audit, production
  WordPress auth/session lifecycle, graph identity, plugin-driver coverage, or
  durable journal semantics outside Playground;
- a claim treats the remote lane's retained-source `verify:release` rows or
  minted session shape as proof of production auth/session lifecycle, durable
  journal correctness, lease/fencing safety, or preserved-remote retry
  safety;
- a create-time identity remap points at a different row, file, or
  relationship-bearing record than the planner originally approved;
- a plugin-owned option, custom table, registry entry, or generated file falls
  outside the allowlist but still shares the same route shape as a covered
  fixture; and
- a stale audit note, review comment, or handoff text is reused after remote
  drift, reminted auth, or a newly discovered plugin-owned surface, even if it
  sounded authoritative for the earlier boundary; and
- a "manual resolution" note resolves the first visible conflict, then a
  later plugin-owned option, custom table, registry row, or generated file is
  discovered and silently treated as covered by the earlier note, so the
  preserved remote can no longer be safely audited or retried; and
- a lab or retained-source `verify:release` run is promoted to production
  evidence without the live WordPress auth/session boundary, preserved remote,
  apply-time revalidation, and journal durability on a real local, Playground,
  or Docker source; and
- a retained-source `verify:release` pass is treated as production-grade push
  evidence unless it also proves live preserved-remote retention, apply-time
  revalidation, graph identity, plugin-driver coverage, and production
  WordPress auth/session lifecycle on the same live boundary.

## Audit boundary for this branch

This branch can only claim progress if it independently reruns the live
boundary that the supervised reliable-executor lane has already refined. The
remote lane's `verify:release` handoff is useful lab evidence, but it is not a
substitute for this branch showing:

- a live source URL and exact executable command here;
- the same rejection point before the first write;
- preserved-remote inspection after rejection;
- apply-time revalidation on a fresh live hash set;
- journal/recovery inspection that survives retry; and
- plugin-driver and graph-identity proof on the same mutation.

Without that branch-local rerun, the audit should continue to say "lab
progress" and not "production-ready," even if the remote lane has already
shown a stronger retained-source contract.
