# Critic Audit

Current baseline for this critique: the supervised reliable-executor lane at
remote head `91ef2b06`, with earlier retained-source proof steps `2ac32891`,
`889bd37a`, and `63a3502f` still useful as history, not as release proof.
The latest explicit verdict on that lane is
`PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`, and the lane's completed
`npm run verify:release` result, including
`authSessionType`, minted session shape, `applyCommitted`, and
`durableJournal.rows: 17`, is material retained-source lab evidence. That is
real progress, and `2ac32891` tightens the release-proof contract, but it
still does not prove a live production boundary because the retained-source
run does not show preserved-remote retention across rejection, live WordPress
auth/session lifecycle, apply-time revalidation against a fresh real-site
source, durable journal storage and lease/fencing semantics outside the
Playground harness, graph identity under remap, or plugin-driver coverage for
late-discovered plugin-owned surfaces. The supervised lane may now be the best
available lab evidence, but this branch still lacks a rerunnable live boundary
that preserves the rejected remote and revalidates from fresh live hashes.
Production-grade wording is still false if it relies on lab-session shape,
retained-source journal rows, or route compatibility as a stand-in for live
WordPress auth/session durability.

The critique target is therefore narrow: this worktree still lacks a rerunnable
live boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`
that preserves the rejected remote, revalidates at apply time, and proves
production WordPress auth/session lifecycle, durable journal storage and
lease/fencing semantics outside the lab harness, graph identity, plugin-driver
coverage, and preserved-remote drift handling on the same mutation. The
supervised reliable-executor lane can provide material retained-source
evidence for those shapes, but that evidence is not enough to claim
production-grade push support here unless the same live boundary is runnable on
this branch and the rejected remote remains auditable and retryable. If the
only available proof is a retained-source or fixture replay, the claim must
stay at "lab progress" rather than "production-ready." On this audit branch
specifically, the gap is the absence of an independently rerun live boundary on
this branch; do not generalize that branch-local gap into a claim that the
supervised lane lacks the command. The next acceptable proof is not another
replay of the retained-source lane; it must be a live WordPress auth/session
boundary with preserved-remote retention, apply-time revalidation,
journal/recovery inspection, lease/fencing proof outside Playground, graph
identity proof, plugin-driver coverage, and exact preserved-remote retry
evidence that can be rerun and audited from this branch.

## Single strongest blocker

This worktree still has no branch-local named real-site release command that
can be rerun unchanged on the same live boundary with preserved-remote
retention and fresh live-hash revalidation. Until that exact boundary
exists here, production-grade push wording is false reliability, even if the
supervised lane has stronger retained-source evidence and an explicit boundary
verdict.

The next acceptable proof must be one rerunnable live command against a real
local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, with:

- the exact command string;
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

Until that live boundary exists, `verify:release` is only a retained-source
lab harness, not evidence that production WordPress push can safely preserve,
inspect, and retry a rejected remote on this branch.

## What improved in the supervised lane

The evidence improved, but only in the lab-harness sense:

- `verify:release` now exists in the remote lane and is exercised as a
  retained-source run rather than route-shape-only smoke.
- The lab evidence now names executor/session/journal details:
  `authSessionType`, minted session shape, `applyCommitted`, and
  `durableJournal.rows: 17`.
- The boundary verdict is explicit instead of implicit, and the latest remote
  head keeps that verdict current instead of stale.

That is real progress, but it still does not prove retry authority on this
branch. A retained-source replay is not the same as a live rerun that preserves
the rejected remote and revalidates apply-time behavior from fresh live hashes
on production WordPress auth/session state.

## What must change before production-grade wording is defensible

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
system is production-ready is a claim without audit-grade support.

Any hidden-loss mode that is not proven there remains a blocker:

- remote drift after dry-run but before apply must be rejected without losing
  the original remote state, and retry scope must be rebuilt from fresh live
  hashes rather than manual judgment;
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

The source notes are still useful, but only as design input:

- Reprint proves resumable pull transport and stage framing in the observed
  upstream commit; it does not prove live push safety, preserved-remote
  retention, or WordPress auth/session lifecycle on this branch.
- ZS-Sync proves bounded discovery and cursoring in the observed upstream
  commit; it does not prove source mutation safety, plugin-driver coverage, or
  retry authority on this branch.
- ForkPress proves merge audit vocabulary and crash-consistency intent in the
  observed upstream commit; it does not prove this branch can preserve the
  rejected remote, classify plugin-owned side effects, or rerun the same live
  boundary with fresh live hashes.

Those notes are strongest when they are treated as input to the design, not as
evidence that the current branch already satisfies release gating. Route shape
similarity, package layout similarity, or a matching review phrase is not proof
of preserved-remote safety.

## Why the latest remote lane still does not unlock release

The remote reliable-executor head now gives better lab evidence, not release
proof:

- `91ef2b06` aligns the release-gate assertions and confirms the retained-
  source verifier path is being tightened, but it still stays inside the
  supervised lane's lab harness.
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
on this branch proves, on the same mutation:

- preserved-remote retention after rejection, with exact audit/retry evidence;
- production WordPress auth/session lifecycle, not just retained-source
  session shape;
- apply-time revalidation against a fresh live source hash set;
- durable journal semantics that survive outside the Playground harness;
- graph identity across create-time remaps and late-discovered records; and
- plugin-driver coverage for plugin-owned surfaces outside the initial
  allowlist.

The reliable-executor lane's retained-source `verify:release` run is still
useful lab evidence, but it is not production proof for this branch until the
same live boundary is rerun here and the preserved remote remains auditable
and retryable.

If a claim cites one of those notes as if it were production proof, it must be
rejected unless the claim also names the exact live boundary and the preserved
remote evidence from this branch.

## Source-note comparison

Source-note comparisons stay provenance only unless they name the exact
upstream state, state what each note proves here, state what it does not
prove here, and are backed by a rerun of the same live boundary on this
worktree.

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
proves here and what it does not prove here.

## Release-gate checklist

Before any production wording, the project must show:

- exact executable command and exact live `REPRINT_PUSH_SOURCE_URL`;
- executor identity and auth/session boundary before the first write;
- preserved remote still inspectable after rejection;
- dry-run receipt plus apply-time revalidation on the same mutation;
- journal/recovery inspection showing retry scope rebuilt from fresh live
  hashes;
- graph identity coverage for create-time remaps and late-discovered surfaces;
- plugin-driver coverage for hidden plugin-owned data traps outside the
  allowlist; and
- old/new/blocked classification for each touched row, file,
  relationship-bearing record, and plugin-owned surface before retry starts.

## False-reliability cases that must fail closed

- a "manual resolution" note covers the first conflict, then a later
  plugin-owned table, cron row, generated file, cache entry, serialized blob,
  or remapped create target appears after the first write;
- a comparison note says Reprint, ZS-Sync, or ForkPress "covers" the branch
  because the route family or package mount looks similar, but it does not
  name the exact upstream state or the exact live boundary on this worktree;
- the supervised reliable-executor lane's retained-source `verify:release`
  result is treated as project evidence only, not as proof that this branch has
  its own rerunnable live boundary, preserved-remote retry audit, or production
  WordPress auth/session lifecycle;
- a claim treats the remote lane's retained-source `verify:release` rows or
  minted session shape as proof of production auth/session lifecycle, durable
  journal correctness, or preserved-remote retry safety;
- a create-time identity remap points at a different row, file, or
  relationship-bearing record than the planner originally approved;
- a plugin-owned option, custom table, registry entry, or generated file falls
  outside the allowlist but still shares the same route shape as a covered
  fixture; and
- a stale audit note, review comment, or handoff text is reused after remote
  drift, reminted auth, or a newly discovered plugin-owned surface, even if it
  sounded authoritative for the earlier boundary; and
- a lab or retained-source `verify:release` run is promoted to production
  evidence without the live WordPress auth/session boundary, preserved remote,
  apply-time revalidation, and journal durability on a real local, Playground,
  or Docker source.
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
