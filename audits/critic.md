# Critic Audit

Current baseline for this critique: the supervised reliable-executor lane at
remote head `889bd37a`, which records the explicit boundary verdict
`PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED`, with `68664884` as the earlier
boundary-verdict step, `63a3502f` as an earlier retained-source proof point,
and `c00eb112` as a later retained-source lab run that still sits below the
production bar. The remote lane's completed `npm run verify:release` result,
including `authSessionType`, minted session shape, `applyCommitted`, and
`durableJournal.rows: 17`, is material retained-source lab evidence. The
remote lane also exposes `verify:release` in `package.json`, so any remaining
absence of that command on this checkout is a branch-local merge gap, not a
project-wide absence. That is useful progress, but it still does not prove a
live production boundary because the retained-source run does not show
preserved-remote retention across rejection, live auth/session lifecycle on
WordPress, apply-time revalidation against a fresh real-site source, or durable
journal semantics outside the Playground harness. Production-grade wording also
remains false if it relies on lab-session shape, retained-source journal rows,
or route compatibility as a stand-in for live WordPress auth/session
durability.

The critique target is therefore narrow: this worktree still lacks a rerunnable
live boundary on a real local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote, revalidates at
apply time, and proves production WordPress auth/session lifecycle, durable
journal storage and lease/fencing semantics outside the lab harness, graph
identity, plugin-driver coverage, and preserved-remote drift handling on the
same mutation. The supervised reliable-executor lane can provide material
retained-source evidence for those shapes, but that evidence is not enough to
claim production-grade push support here unless the same live boundary is
runnable on this branch and the rejected remote remains auditable and retryable.
If the only available proof is a retained-source or fixture replay, the claim
must stay at "lab progress" rather than "production-ready." On this audit
branch specifically, the gap is the absence of the named real-site release
command and rerunnable live boundary; do not generalize that branch-local gap
into a claim that the supervised lane lacks the command.
The next acceptable proof is not another replay of the retained-source lane;
it must be a live WordPress auth/session boundary with preserved-remote
retention, apply-time revalidation, and journal/recovery inspection that can
be rerun and audited from this branch.

## Single strongest blocker

This worktree still has no named real-site release command that can be rerun
unchanged on the same live boundary. Until that exact boundary exists here,
production-grade push wording is false reliability, even if the supervised
lane has stronger retained-source evidence and an explicit boundary verdict.

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
- The boundary verdict is explicit instead of implicit.

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
  WordPress state, not just retained-source lab state;
- explicit old/new/blocked classification for touched rows, files,
  relationship-bearing records, and plugin-owned surfaces; and
- plugin-driver coverage for late-discovered plugin-owned data traps outside
  the allowlist, with explicit handling for plugin-owned state that is not
  visible in the initial plan; and
- a preserved-remote receipt that is still inspectable after rejection and
  lets a reviewer audit, retry, and compare the exact boundary without
  depending on manual resolution.

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
  new mutation, not a safe continuation; and
- partial file, DB, and plugin side effects must never be reported as success
  without a preserved-remote receipt that lets a reviewer audit and retry the
  exact rejected boundary.

Manual resolution is not success unless the remote is preserved and the user
can safely audit and retry the exact boundary.

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
