# Critic Audit

## 2026-05-25 Production Wording Still Fails Without a Real-Site Release Command

The branch still cannot claim production-grade push support because `npm run
verify:release` may strengthen the release topology, but it does not yet prove a
branch-local, named real-site release command that can be rerun unchanged against
a live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` and preserve the
rejected remote for audit.

Scenario: someone upgrades a green Playground run or a polished script name into
"production-ready push". Missing proof: the repo still lacks a live release
command that prints the exact executor/auth boundary before the first write, the
preserved remote that remained inspectable after rejection, the exact rejection
point, the apply-time revalidation result, and the journal/recovery inspection
used to rebuild retry scope. Without those facts from one rerun, the claim is
compatibility evidence only, even if `verify:release` now proves more of the
release topology than the older smoke wrappers did.

Scenario: a reviewer treats a source-note comparison as current retry authority.
Missing proof: Reprint, ZS-Sync, and ForkPress notes are still historical input
unless this branch reran the same live boundary and the note says what it proves
here and what it does not prove here. Shape similarity does not establish live
push safety, preserved-remote auditability, create-time identity remap handling,
or plugin-owned surface classification on this branch.

The next exact proof reliable-executor must produce is one rerunnable command,
invoked against a live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`,
that records all of the following in the same run:

- the exact command string;
- the executor identity and auth/session boundary before the first write;
- the preserved remote that stayed inspectable after rejection;
- the exact rejection point before the first write;
- the apply-time revalidation result on the live boundary;
- the journal/recovery inspection used to define retry scope; and
- the classification of any plugin-owned surface, including late-discovered
  ones and remapped create targets.

Until that rerun exists, production wording must fail closed. Route shape,
fixture replay, manual review notes, and source-note comparisons remain
compatibility evidence only.

Release-gate checklist for production wording:

- exact branch-local command string, runnable without prose edits;
- exact live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`;
- preserved remote that stays inspectable after rejection;
- apply-time revalidation on the same boundary before the first write;
- journal and recovery inspection that defines retry scope;
- executor identity plus auth/session boundary before the first write;
- old/new/blocked classification for every touched row, file, relationship-
  bearing record, and plugin-owned surface before retry starts; and
- separate preserve / reject / retry cycle for any later-discovered plugin-
  owned surface or remapped create target.

The same run also needs an explicit conflict-policy decision for every touched
surface. Scenario: a reviewer says "manual resolution" without saying whether a
surface was blocked, preserved, retried, or sent to manual review after the
remote was audited. Missing proof: later readers cannot tell whether the old
remote, a remapped create target, or a plugin-owned data trap was intentionally
left untouched, so the remote cannot be safely audited or retried. Any
production-grade claim that omits the policy for old/new/blocked surfaces must
fail closed.

Source-note comparisons need the same rigor. Scenario: a reviewer cites Reprint,
ZS-Sync, or ForkPress and treats the note as retry authority because the route
family or wording looks similar. Missing proof: the exact upstream revision or
worktree state, the exact live boundary rerun on this branch, and an explicit
statement of what the note proves here and what it does not prove here. Without
those facts, the comparison remains historical context only and cannot support
production wording.

## 2026-05-25 Commit `25c4ef54` Is Live Preflight Only, Not Production Proof

Commit `25c4ef54` adds `npm run
test:playground:production-shaped-release-verify` and reaches
`LIVE_PREFLIGHT_OK` against a local Playground source. That is a useful live
preflight, but it is still not production-grade push support until the same
run also proves preserved-remote retention, apply-time revalidation, journal
and recovery inspection, production auth/session lifecycle, graph identity,
and plugin-owned surface classification on the live boundary.

Scenario: a reviewer upgrades `LIVE_PREFLIGHT_OK` to "production-ready push"
because the command is executable and the source is live. Missing proof: the
branch still does not show the rejected remote remaining inspectable after
rejection, the exact first-write rejection point, the live apply-time
revalidation result, or the journal/recovery record that defines retry scope.
Without those, the command proves only that a live preflight can run, not
that a remote can be preserved, audited, and safely retried after drift.

Scenario: someone treats the new command as proof that auth, session, and
graph boundaries are production-safe. Missing proof: the current claim does
not yet demonstrate the full auth/session lifecycle on the live source, nor
does it prove create-time identity remap handling or later-discovered
plugin-owned surfaces at apply time. A live preflight can still be a lab
boundary if it does not show those exact transitions and their preserved
artifacts.

The next exact proof reliable-executor must produce is a rerun of
`npm run test:playground:production-shaped-release-verify` against a live
local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that prints, in one
run, the preserved remote that stayed inspectable after rejection, the exact
rejection point before the first write, the apply-time revalidation result,
the journal/recovery inspection used to rebuild retry scope, the production
auth/session boundary, the graph-identity evidence, and the classification of
all plugin-owned surfaces. Until that exact rerun exists, `LIVE_PREFLIGHT_OK`
remains preflight evidence only.

Scenario: a reviewer reads `LIVE_PREFLIGHT_OK` as if it already covers the
source-note comparisons to Reprint, ZS-Sync, or ForkPress. Missing proof: the
upstream notes are still historical design input, and this branch has not yet
rerun the same live mutation boundary with preserved-remote evidence, stale-
authority rejection, and a fresh live-hash retry scope. The note can tell us
what the upstreams prove in their own context; it cannot supply the branch-
local live boundary or the production auth/session, graph identity, and
plugin-driver proofs that are still missing here.

## 2026-05-25 Commit `2b00b189` Is Still A Wrapper, Not Release Proof

Commit `2b00b189` adds a release-shaped wrapper, but the branch still does
not show the live source endpoint that wrapper needs in order to become
production evidence. The missing proof is not a better script label; it is a
real-site command that runs against a live local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL`, proves the preserved remote stayed inspectable
after rejection, and prints the exact executor/auth boundary before the first
write.

Scenario: a reviewer points to `npm run test:playground:production-shaped-release-proof`
and treats the commit as a release gate. Missing proof: the repo surface still
does not expose that command in `package.json`, so the claim is a wrapper over
missing inputs unless the next run names the exact real-site command string,
the live `REPRINT_PUSH_SOURCE_URL`, the preserved remote that remained
auditable after rejection, the apply-time revalidation boundary, the recovery
journal inspection, and the auth/session boundary before the first write.

Scenario: someone points to `npm run test:playground:production-shaped-release-proof`
and treats the name as a release gate. Missing proof: `package.json` does not
expose that command, and the commit does not supply a live source endpoint,
apply-time revalidation, recovery-journal inspection, or auth/session boundary
evidence for an actual remote.

The next command reliable-executor must produce is a named real-site
preflight/release invocation that can be rerun on demand and that prints, in
one run, the live `REPRINT_PUSH_SOURCE_URL`, the executor identity, the
preserved remote that remained auditable after rejection, the exact
rejection point before the first write, the journal/recovery inspection
needed to audit retry scope, and the first live executor/auth/preserved-
remote boundary. Until that exact command exists and is rerun on a real
remote, commit `2b00b189` stays a compatibility wrapper only.

Scenario: someone points to `npm run test:playground:production-shaped-release-verify`
and treats it as the named real-site release command. Missing proof: that
command is only acceptable here if the branch can show the same live boundary
on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, and it
still has to prove preserved-remote retention, apply-time revalidation,
journal/recovery inspect, auth/session lifecycle, graph identity, and
plugin-owned surface classification in the same rerun. A live preflight label
without that evidence is still compatibility work.

## 2026-05-25 Real-Site Command Still Missing

Primary finding: this branch still does not expose a single named real-site
preflight/release command. `package.json` now offers `plan`, `apply`,
`test:playground:*`, and `test:playground:production-shaped-release-verify`,
but the new wrapper still only proves a live preflight against a local
Playground source. That means every production-shaped smoke remains lab or
compatibility evidence only unless it reruns the exact remote mutation path on
an actual remote and leaves the rejected remote inspectable for audit and
retry.

If a release claim is only a wrapper around missing inputs, that is still setup
work, not proof. The branch needs one exact rerunnable command string, one live
`REPRINT_PUSH_SOURCE_URL`, and one preserved remote that stayed auditable after
rejection before any production wording can be defended.

The next missing proof is concrete: the branch still has not produced a named
command string that was run against a real local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL` and recorded the executor identity, the preserved
remote, and the exact rejection point before the first write. The next
acceptable command must be a real-site release/preflight invocation that
prints those three facts, can be rerun on demand, and preserves the rejected
remote for audit. Until that command exists and can be rerun, any
production-readiness wording is still just a wrapper around compatibility
evidence.

Release-gate checklist for production wording:

- exact branch-local command string, runnable without prose edits;
- exact live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`;
- preserved remote that stays inspectable after rejection;
- apply-time revalidation on the same boundary before the first write;
- journal and recovery inspection that defines retry scope;
- executor identity plus auth/session boundary before the first write; and
- the same run must show which remote was rejected, not just that a retry
  path exists.

This is still the current answer to the loop focus: there is no branch-local
command that has been run against a real local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL` and recorded the first executor/auth/preserved-
remote boundary. Until that boundary exists, comparison notes, route-shape
smokes, the live preflight wrapper, and manual-review artifacts stay audit
context only.

Scenario: someone points to `test:playground:authenticated-http-push`,
`test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`,
or `test:playground:production-plugin-package` and treats the name as release
proof. Missing proof: none of those scripts is a branch-local real-site
entry point, and none of them has shown the live executor/auth/preserved-
remote boundary on an actual remote here. Without that rerun, the scripts are
smoke coverage only, even if they are useful for compatibility checks.

Scenario: a review note upgrades one of those smoke names into a
"production-shaped live protocol proof" without naming a real-site command.
Missing proof: `package.json` still exposes only lab and playground scripts,
so the note is still relying on shape-matching, not a rerun of the live
boundary with preserved-remote evidence and retry scope rebuilt from live
hashes.

Scenario: an operator sees a green smoke, a polished review note, or a
production-sounding script name and assumes push support is ready. Missing
proof: there is still no branch-local command that can be rerun against a real
`REPRINT_PUSH_SOURCE_URL`, record the first executor/auth/preserved-remote
boundary, and keep the rejected remote auditable after rejection. Without that
command, stale-drift rejection, create-time identity remap handling, and
plugin-owned surface classification remain claims, not release proof.

What still has to be shown before production wording is credible:

- the exact live preflight command must be rerun against a real
  `REPRINT_PUSH_SOURCE_URL`, not only a local Playground source;
- the exact real-site command name, not just a Playground or lab smoke or a
  wrapper around one;
- the exact command string must be rerunnable without prose changes, and it
  must name the live `REPRINT_PUSH_SOURCE_URL` it was run against;
- the exact live boundary and exact stale-drift case that was rerun here;
- the exact rejection point before the first write;
- preserved-remote evidence that stays inspectable after rejection;
- production auth and session lifecycle proof against that same live boundary,
  not just a route-shaped credential check;
- durable recovery-journal semantics for retries, not just readable notes or
  fixture-backed replay;
- graph identity handling at apply time, including remapped create targets and
  later-discovered relationship-bearing records;
- plugin-driver coverage for any plugin-owned surface outside the allowlist,
  including hidden tables, cron rows, runtime registries, generated files,
  caches, serialized blobs, and plugin-owned files;
- old/new/blocked classification for every touched file, DB row,
  relationship-bearing record, and plugin-owned surface before retry starts;
- a separate preserve/reject/retry cycle for any later-discovered plugin-owned
  surface or remapped create target; and
- a conflict-policy statement that says whether the next action is block,
  preserve, retry, or manual review, while still preserving the remote for
  audit and retry.

Minimum evidence for the next release-shaped proof:

- one branch-local command string that can be rerun unchanged;
- one live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` used by
  that command;
- one preserved remote that stays inspectable after rejection;
- one exact rejection point before the first write;
- one apply-time revalidation result that shows the live boundary was checked
  again before mutation;
- one journal/recovery inspection that explains retry scope; and
- one auth/session boundary record that proves the command was not just a
  wrapper around lab state.

If those items are absent, then route shape, package layout, reviewer wording,
fixture replay, and `finalMatchesLocal` remain compatibility evidence only.

## 2026-05-25 Real-Site Release Command Gap

Primary finding: this branch still does not expose a single named real-site
preflight/release command that can be rerun against an actual remote and
prove the live boundary end to end.

Setup-only gate: a missing `REPRINT_PUSH_SOURCE_URL`, a placeholder local
Playground, or a Docker-only source URL is still just setup. Until one command
uses a real local/Playground/Docker `REPRINT_PUSH_SOURCE_URL`, runs the live
preflight, and records the first executor/auth/preserved-remote boundary, it
does not count as production proof.

Scenario: an operator sees a green `plan`, `apply`, or `test:playground:*`
result and assumes production safety. Missing proof: there is still no branch-
local executable that reruns the exact live boundary, preserves the rejected
remote for audit, records the rejection point before the first write, and
rebuilt retry scope from fresh live hashes in one auditable flow.

That gap matters because any later-discovered plugin-owned surface, remapped
create target, or partial file/DB/plugin side effect can still be hidden by a
smoke or review artifact. Until the branch has a named real-site release
command with preserved-remote evidence, route shape and review wording remain
compatibility evidence only.

## 2026-05-25 Source-Note Comparisons Stay Historical

Comparison notes for Reprint, ZS-Sync, and ForkPress are still useful as
design context, but they are not live retry authority on this branch. The
missing proof is not just an upstream citation; it is the branch-local rerun
of the same live mutation boundary with the preserved remote, rejection point,
and fresh live hashes still inspectable after rejection.

Scenario: a reviewer sees a source-note comparison that looks close enough to
the current route family or reviewer wording and assumes the branch now has
production-grade push evidence. Missing proof: the comparison does not say
that this branch reran the same live boundary, so it still cannot prove
stale-drift rejection before the first write, create-time identity remap
handling at apply time, plugin-owned surface enumeration, or partial side-
effect classification before retry.

What each note proves, and what it does not:

- Reprint proves staged pull sequencing and resumability vocabulary; it does
  not prove live push safety, preserved-remote retention after rejection, or
  stale remote drift rejection on this branch.
- ZS-Sync proves bounded scanning and resource-discovery ideas; it does not
  prove source mutation safety, plugin-owned allowlist coverage, or late
  plugin-data-trap handling before write.
- ForkPress proves audit and crash-consistency vocabulary; it does not prove
  that a readable review artifact can authorize a later boundary, preserve
  the rejected remote, or become retry authority for a remapped create target
  or plugin-owned surface.

Any production wording that cites these notes must also name the exact cited
upstream state, the exact live boundary rerun on this branch, the preserved
remote, and the retry scope rebuilt from live hashes. If it cannot do that,
the comparison stays historical context only.

## 2026-05-25 Production Push Readiness Re-Audit

Verdict: the design still cannot claim production-grade push support.

Primary blocker: `package.json` exposes only lab and playground entry points
(`plan`, `apply`, and `test:playground:*`); it does not expose a single
named real-site preflight/release command that can be rerun against an actual
remote and prove the live boundary while preserving the rejected remote,
rejection point, and fresh retry scope in one auditable flow. The existing
`test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`,
and `test:playground:production-plugin-package` scripts are still smoke tests,
not a production release command: they may demonstrate route shape or fixture
behavior, but they do not by themselves give a rerunnable live boundary with
preserved-remote proof. The `plan` and `apply` bin wrapper is also not enough,
because it still lacks a named real-site entry point, a live executor boundary,
and preserved-remote evidence from an actual remote. Until that command exists
and is named here, any doc, PR, or review wording is still lab-backed or
comparison-only, no matter how production-shaped the route or reviewer language
looks.

That missing command is not a wording gap. It is visible in the actual script
surface today: there is no `real-site` or equivalent release entry point in
`package.json`, so the branch cannot yet point to an executable proof path for
operators to rerun on an actual remote.

That absence matters because the branch still has no executable surface that
can be handed to a real-site operator, rerun after drift, and independently
prove the preserved remote was still inspectable when the write was rejected.
Route shape, reviewer wording, and smoke logs do not supply that proof.

Concrete release-gate failure mode:

- if the only runnable proof is a smoke script, Playground route, or review
  artifact, the branch still lacks a real-site preflight/release command;
- if that command is missing, the branch cannot show the exact reject point
  before the first write on a live remote; and
- if the preserved remote is not auditable after rejection, then manual
  resolution, comparison notes, and `finalMatchesLocal` remain audit-only and
  cannot be promoted to production wording.

Command-surface audit:

- `plan` and `apply` are present, but they are not a named real-site release
  command and do not by themselves prove a live remote was preserved after
  rejection.
- `test:playground:*` entries are useful lab checks, but they only prove
  fixture or Playground behavior unless one of them is explicitly the real-
  site release command and reruns the live boundary on an actual remote.
- The missing evidence is not another reviewer phrase, route-smoke polish, or
  source-note comparison; it is the branch-local executable that can be rerun
  against a real remote and yields preserved-remote proof for the rejected
  boundary.

This is the critical production gate because the current scripts can still
prove only fixture or lab behavior. They do not prove that a live remote was
preserved after rejection, that a stale approval was rejected before the first
write, or that a later-discovered plugin-owned surface, remapped create target,
or mixed file/DB/plugin side effect was classified before retry started.

What still has to change before any production-grade claim is credible:

- the branch must show the exact live boundary, the exact stale-drift case, and the exact rejection point before the first write;
- the rejected remote must stay inspectable for audit and retry, not merely be mentioned in a readable note;
- every touched file, DB row, relationship-bearing record, and plugin-owned surface must be classified old, new, or blocked before retry starts, including mixed file/DB/plugin side effects;
- a later-discovered plugin-owned surface, remapped create target, or relationship-bearing record must get its own live-boundary proof; a prior readable note cannot be widened to cover it retroactively;
- any later-discovered plugin-owned surface or remapped create target must become a new live boundary unless it was already enumerated before write and separately blocked or classified;
- any conflict-policy claim must say whether the next action is block, preserve, retry, or manual review, and it must prove that the preserved remote stays inspectable for audit and retry instead of being repackaged as generic success evidence;
- any lab fixture, copied executor, or production-shaped route smoke can still preserve the wrong remote, skip a hidden plugin-owned surface, or replay stale approval, so a matching URL or mount shape is compatibility evidence only and never proof of live push safety;
- any claim that "we can release" or "we are production-ready" fails if it does not name the exact command that will rerun against an actual remote and prove the remote was preserved after rejection;
- if the route family, package layout, reviewer wording, or fixture shape matches an earlier approval, that only proves surface similarity; the later boundary still needs its own preserved remote, rejection point, and fresh retry scope rebuilt from live hashes;
- any readable manual-resolution note or comparison summary must not be allowed to retroactively authorize a later-discovered plugin-owned surface, remapped create target, or relationship-bearing record, even if the route family, package layout, or reviewer wording stays identical;
- any source-note comparison to Reprint, ZS-Sync, or ForkPress is provenance only unless it names the exact upstream state, the exact live boundary, what it proves here, what it does not prove here, and whether this branch reran that same boundary locally; shape similarity alone must never become retry authority;
- any source-note comparison to Reprint, ZS-Sync, or ForkPress stays historical context unless this branch also exposes a single executable real-site preflight/release command and reruns the same live boundary on an actual remote; without that branch-local command, the comparison cannot be elevated to production wording;
- any script name such as `production-shaped`, `authenticated`, `authenticated-cli-push`, `authenticated-http-push`, or `production-plugin-package` still counts as compatibility evidence only if the repo surface remains `plan`, `apply`, `test`, and `test:playground:*`; a production-sounding name does not prove the live executor boundary, preserved remote, or fresh retry scope;
- any "manual resolution" or "comparison passed" wording must stay audit-only unless it names the preserved remote, the upstream source-note state, and the same live boundary rerun on this branch; and
- any production-shaped route smoke, lab fixture, or readable review artifact still fails if it cannot show the exact remote that stayed inspectable after rejection, the exact rejection point before the first write, and the exact set of rows, files, relationship-bearing records, and plugin-owned surfaces classified old, new, or blocked before retry started; route shape and reviewer wording are compatibility evidence only, not release proof;
- route shape, package layout, fixture replay, readable review output, and `finalMatchesLocal` remain compatibility evidence only; if those are the only proof, the missing evidence is still the live executor boundary itself, plus the rejected remote and fresh retry scope rebuilt from live hashes.

Release-gate checklist for production-grade wording:

- name the exact executable real-site preflight/release command, or treat the
  absence of that command as a blocker;
- do not confuse `test:playground:*` or other smoke scripts with a release
  command; they remain compatibility evidence unless they rerun the live
  boundary on an actual remote and preserve the rejected remote for audit;
- name the exact live boundary and exact stale-drift case, not just the route family or product path;
- keep the rejected remote inspectable after rejection so the user can audit the drift and retry from fresh live hashes;
- reject stale approval or manual-review artifacts before the first write, and do not let them widen to later rows, files, relationship-bearing records, remapped create targets, or plugin-owned surfaces;
- treat any later-discovered plugin-owned surface as a new boundary unless it was enumerated before write or separately blocked with its own preserve / reject / retry cycle;
- any late-discovered plugin-owned surface or remapped create target that appears only after the first write is a production blocker until the branch proves it was enumerated before write or separately preserved, rejected, and retried on the live boundary; a polished smoke log cannot widen the earlier approval;
- classify every touched file, DB row, relationship-bearing record, and plugin-owned surface as old, new, or blocked before retry starts, including mixed file/DB/plugin side effects;
- name the exact upstream state for any Reprint, ZS-Sync, or ForkPress comparison, say what it proves here, say what it does not prove here, and rerun the same live boundary on this branch before treating it as more than historical context; and
- keep route shape, package layout, fixture replay, readable review output, and `finalMatchesLocal` downgraded to compatibility evidence unless the same live boundary also shows preserved-remote evidence and a fresh live-hash retry scope.

Failure classes that still block production wording:

- live remote drift after dry-run but before apply: the missing proof is the actual rejection point before first write plus a preserved remote that stays inspectable for audit and retry;
- create-time identity remap or aliasing: the missing proof is live identity evidence at the apply boundary, or an explicit hard block before any write;
- plugin-owned data traps outside the allowlist, including hidden options, serialized blobs, generated files, caches, cron rows, and runtime registries: the missing proof is that each surface was enumerated or blocked before write, not discovered afterwards;
- partial file, DB, or plugin side effects: the missing proof is old/new/blocked classification for the full touched set before retry starts, so mixed outcomes cannot be relabeled as success; and
- stale manual-review artifacts: the missing proof is that the artifact stayed audit-only after drift and could not widen to a later boundary, even if the wording still looks fresh.

Source-note comparison audit:

- Reprint (`docs/source-notes.md`, observed commit `27c5f25`) proves staged
  pull delivery, resumability vocabulary, and transport framing. It does not
  prove live push safety here, preserved-remote retention after rejection,
  stale-drift rejection before the first write, create-time identity remap
  handling, hidden plugin-owned state outside the allowlist, or late
  plugin-owned surface handling on this branch. A route-family match or
  reviewer-phrase match is historical context only, not retry authority.
- ZS-Sync (`docs/source-notes.md`, observed commit `d9334a0`) proves bounded
  scanning, resource discovery, and batching ideas. It does not prove source
  mutation safety, plugin-owned allowlist coverage, stale-authority rejection,
  or partial file, DB, and plugin side-effect classification before retry on
  this branch.
- ForkPress (`docs/source-notes.md`, observed worktree `55f9879`) proves
  audit vocabulary, merge-review framing, and crash-consistency intent. It
  does not prove that a readable manual-review artifact can authorize a later
  boundary, preserve the rejected remote for audit, or become retry authority
  for a remapped create target or plugin-owned surface on this branch. Even a
  perfect wording match stays audit-only unless this branch reran the same
  live boundary with live hashes. A preserved review note is only historical
  context until the branch also proves the rejected remote stayed inspectable
  after rejection and the later boundary rebuilt retry scope from fresh live
  hashes. If this branch has not rerun that same live boundary, the note is
  comparison-only and cannot be promoted to production proof.

Comparison gap summary:

- Reprint helps with sequencing language, not with proving the pushed remote
  stayed inspectable after rejection or that a later-discovered plugin-owned
  table, cron row, runtime registry, generated file, cache, or serialized blob
  was blocked before write.
- ZS-Sync helps with discovering changes in bounded batches, not with proving
  that every discovered row, file, relationship-bearing record, or plugin-owned
  surface was classified old, new, or blocked before retry started.
- ForkPress helps with audit and crash-consistency vocabulary, not with proving
  that a readable review artifact cannot be widened to a remapped create
  target, hidden plugin state, or second live boundary after drift.
- If any Reprint, ZS-Sync, or ForkPress note only matches the same route
  family, package mount, reviewer wording, or fixture shape, it is still just
  historical context. That similarity does not prove live retry authority for a
  later boundary, does not prove the remote stayed preserved after rejection,
  and does not prove a late-discovered plugin-owned surface was enumerated or
  blocked before the first write. A note can describe provenance; it cannot
  become retry authority unless this branch reran the same live boundary and
  kept the rejected remote inspectable for audit.

Scope note: this audit only accepts production wording when the same live
boundary on this worktree shows preserved-remote evidence, stale authority
rejection before the first write, fresh retry scope rebuilt from live hashes,
and old/new/blocked classification for every touched surface. Lab-shaped
route matches, package-mount matches, fixture replay, readable manual-review
artifacts, production-shaped URL smokes, and `finalMatchesLocal` stay
compatibility evidence only.
Even a precise upstream commit or a matching route family is still only
historical design context unless this branch reran the same live boundary and
kept the rejected remote inspectable for audit/retry.

What must happen before any production-grade push claim:

- the exact live boundary and exact stale-drift case must be named;
- the rejected remote must stay inspectable after rejection so the user can
  audit the drift and retry from fresh live hashes;
- the stale approval or manual-review artifact must be rejected before the
  first write and cannot widen to a later row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface;
- any conflict policy claim must say whether the next action is block, retry,
  preserve, or manual resolve, and it must prove that the choice cannot hide a
  remote drift, remapped create target, or late plugin-owned surface behind a
  readable success note;
- any later-discovered plugin-owned surface must be treated as a new boundary
  unless it was enumerated before write or separately blocked with its own
  preserve / reject / retry cycle;
- every touched file, DB row, relationship-bearing record, and plugin-owned
  surface must be classified old, new, or blocked before retry starts,
  including mixed file/DB/plugin side effects;
- any create-time identity remap must be proven safe at the apply boundary or
  blocked before the first write; a fixture that preserves the original ID is
  not enough;
- any comparison to Reprint, ZS-Sync, or ForkPress must name the exact
  upstream state, state what the note proves here, state what it does not
  prove here, and be rerun against the same live boundary on this branch; and
- any source-note comparison that names the upstream anchor but does not say
  whether this branch reran the same live boundary is still historical
  context only, even if the route family, package layout, or reviewer
  wording matches;
- route shape, package layout, fixture replay, readable review output, and
  `finalMatchesLocal` remain compatibility evidence only unless they are
  paired with the preserved remote and a fresh retry scope rebuilt from live
  hashes on this worktree.

Release-claim hard stop:

- if the evidence does not name the exact live boundary, the exact stale-drift
  case, and the exact rejection point before the first write, the claim fails;
- if the rejected remote is not still inspectable for audit and retry, the
  claim fails, even when a readable note says "manual resolution" or
  "comparison passed";
- if "manual resolution" is being used to mean "trust the note and move on",
  the claim fails unless the preserved remote is still available to inspect,
  the exact rejection point is recorded before first write, and the same live
  boundary can be rerun from fresh hashes;
- if any touched file, DB row, relationship-bearing record, or plugin-owned
  surface is missing old/new/blocked classification before retry starts, the
  claim fails;
- if a later-discovered plugin-owned surface or remapped create target is
  being folded back into an earlier approval, the claim fails unless that
  later boundary got its own preserve / reject / retry cycle; and
- if the only support is route shape, package layout, fixture replay,
  readable review output, or `finalMatchesLocal`, the claim stays
  compatibility-only.

Release-gate checklist for production-grade wording:

- name the exact live boundary and the exact stale-drift case, not just the
  route family or product path;
- keep the rejected remote inspectable after rejection so the user can audit
  the drift and retry from fresh live hashes;
- reject stale approval or manual-review artifacts before the first write, and
  do not let them widen to later rows, files, relationship-bearing records,
  remapped create targets, or plugin-owned surfaces;
- treat any later-discovered plugin-owned surface as a new boundary unless it
  was enumerated before write or separately blocked with its own preserve /
  reject / retry cycle;
- classify every touched file, DB row, relationship-bearing record, and
  plugin-owned surface as old, new, or blocked before retry starts, including
  mixed file/DB/plugin side effects;
- name the exact upstream state for any Reprint, ZS-Sync, or ForkPress
  comparison, say what it proves here, say what it does not prove here, and
  rerun the same live boundary on this branch before treating it as more than
  historical context; and
- keep route shape, package layout, fixture replay, readable review output,
  and `finalMatchesLocal` downgraded to compatibility evidence unless the same
  live boundary also shows preserved-remote evidence and a fresh live-hash
  retry scope.

Production-readiness gate, in one place:

- the exact live boundary and the exact stale-drift case are named;
- the rejected remote stays inspectable after rejection so the user can audit
  the drift and retry from fresh live hashes;
- the stale approval or manual-review artifact is rejected before the first
  write and cannot widen to a later row, file, relationship-bearing record,
  remapped create target, or plugin-owned surface;
- any later-discovered plugin-owned surface is treated as a new boundary
  unless it was enumerated before write or separately blocked with its own
  preserve / reject / retry cycle;
- every touched file, DB row, relationship-bearing record, and plugin-owned
  surface is classified old, new, or blocked before retry starts, including
  mixed file/DB/plugin side effects;
- any comparison to Reprint, ZS-Sync, or ForkPress names the exact upstream
  state, says what the note proves here, says what it does not prove here,
  and is rerun against the same live boundary on this branch; and
- route shape, package layout, fixture replay, readable review output, and
  `finalMatchesLocal` remain compatibility evidence only unless they are
  paired with the preserved remote and a fresh retry scope rebuilt from live
  hashes on this worktree.

Proof-classification rule: if a comparison note, manual-review artifact, or
release comment does not explicitly say whether it is historical context,
compatibility evidence, or live retry proof, it must fail closed. The same
rule applies to later-discovered plugin-owned surfaces: the wording has to say
whether that surface is in scope, excluded, or blocked before write, because
a note that never names the boundary cannot authorize a later boundary.
If the wording only says that the route shape, package mount, reviewer note,
or fixture looked production-shaped, it is still compatibility evidence only.
That phrasing cannot become production proof unless the same live boundary on
this branch also shows the preserved remote, the stale rejection point, and a
fresh retry scope rebuilt from live hashes.
Human review cannot widen a boundary by itself: a readable approval note,
manual-resolution comment, or comparison summary stays audit-only unless it
also proves the exact rejected boundary, the preserved remote that remained
inspectable after rejection, and the fresh retry scope for that same live
boundary on this worktree.
The same rule applies to "release support" wording: if a PR description,
status comment, or source-note comparison does not name the exact real-site
preflight/release command and the exact live boundary it reran, it cannot
authorize later rows, files, relationship-bearing records, remapped create
targets, or plugin-owned surfaces. A note that proves only the earlier
boundary is not a license to expand scope to a later one, even if the route
family, package layout, or reviewer wording is unchanged.
If the wording says "comparison passed", "manual resolution succeeded", or
"production-ready" without naming the preserved remote and the boundary that
was rejected before write, that wording is false reliability and must fail
closed.

Current weakest claim to reject: a production-shaped `/wp-json/reprint/v1/push/*`
smoke, a readable "manual resolution" note, or a Reprint/ZS-Sync/ForkPress
comparison can look like live retry proof after drift. Missing proof is still
the same live boundary rerun on this branch, the exact stale-drift case, the
preserved remote that stayed inspectable after rejection, the rejection point
before the first write, and old/new/blocked classification for every touched
surface. Without all of that, the smoke, note, and comparison remain
compatibility evidence or audit evidence only, even when the route family,
package layout, reviewer wording, or upstream anchor match the production
path. A later-discovered plugin-owned surface or remapped create target still
needs its own preserve / reject / retry cycle; shape similarity does not
widen the earlier boundary.

Current highest-value blocker: the branch still does not expose a real-site
preflight/release command that proves the same live boundary on an actual
remote and records the preserved remote, rejection point, and retry scope in a
single executable flow. The missing proof wrapper is specifically a command
that can run against a real local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL`, execute live preflight, and record the first real
executor/auth/preserved-remote boundary. Until such a command exists and is
audited end to end, the design cannot claim that the protocol docs, smoke
tests, or manual-review notes are production release support rather than
lab-only compatibility evidence. If the only available entry points remain
`plan`, `apply`, and `test:playground:*`, the branch is still lab-only and the
release gate fails closed.

Primary verdict for this iteration: no branch-local proof exists yet for a
named real-site preflight/release command. That missing command is the
release blocker, and every "production-shaped" smoke or comparison note must
stay downgraded until the branch can rerun the exact live boundary on an
actual remote and keep the rejected remote inspectable for audit and retry.
Reprint, ZS-Sync, and ForkPress remain source-note provenance only unless the
branch-local rerun says exactly what each note proves here and what it does
not prove here.

Fail-closed wording rule:

- compatibility evidence: route shape, package layout, fixture replay,
  production-shaped URLs, readable review output, and `finalMatchesLocal`
  show at most that the executor can mimic the expected surface;
- audit evidence: a readable manual-resolution note, comparison summary, or
  reviewer comment shows what someone believed happened, but not that the
  live boundary was retried safely;
- live retry proof: only the same live boundary on this branch, the preserved
  remote that stayed inspectable after rejection, the exact stale-drift case,
  the rejection point before the first write, and per-surface old/new/blocked
  classification prove production-grade push safety; and
- if any wording blurs those classes together, it is false reliability and
  must fail closed, even when the route family, package layout, or reviewer
  wording looks production-shaped.

Concrete failure scenarios that still block production wording:

- live remote drift after dry-run but before apply: missing proof is the
  actual apply-boundary rejection point plus a preserved remote that the user
  can inspect and retry from, not a green fixture replay or readable note;
- create-time identity remap, alias, or renumbering: missing proof is live
  identity evidence that shows the remap is safe, or a hard block before the
  first write, not a fixture that keeps the same ID shape;
- ambiguous conflict policy: missing proof is an explicit rule for whether a
  changed row, file, relationship-bearing record, or plugin-owned surface is
  blocked, preserved, or retried, not a vague "manual resolution" label that
  lets a later note reinterpret the outcome as success;
- plugin-owned state outside the allowlist, including hidden tables, cron
  rows, runtime registries, generated files, caches, and serialized blobs:
  missing proof is live enumeration or an apply-time block for every owned
  surface, including ones discovered only after the first write; a post-write
  discovery cannot be widened back into the earlier approval;
- partial file, DB, or plugin side effects: missing proof is old/new/blocked
  classification for every touched surface before retry, so a mixed write
  cannot be relabeled as success after the committed part;
- stale manual-review artifacts after drift: missing proof is that the
  artifact stayed audit-only, could not become retry authority for a later
  row/file/relationship-bearing record/remapped target/plugin surface, and
  was replaced by a fresh retry scope rebuilt from live hashes; "manual
  resolution later" is only success for the exact rejected boundary it names,
  never for a later remapped create target or plugin-owned surface that was
  not already enumerated before write; and once a later plugin-owned data
  trap appears, it is a new boundary unless it is separately enumerated or
  blocked before write, even if the route family, package mount, or reviewer
  wording looks unchanged;
- stale manual-review artifacts that look fresh after a rerun are still not
  proof of production safety unless they identify the exact rejected
  boundary, the preserved remote for that boundary, and the fresh live-hash
  retry scope for the rerun; a polished note can still hide a second
  boundary, a remapped create target, or a late plugin-owned surface that was
  never part of the original preserve / reject / retry cycle, and a note
  that only repeats the upstream wording without naming the branch-local live
  rerun is still audit-only;
- false reliability claims: missing proof is that "comparison passed",
  "manual resolution succeeded", or "production-ready" names the rejected
  remote, the rejection point, and the exact live boundary that was retried;
  otherwise the wording can hide a failed first boundary behind a later
  readable artifact;
- stale manual-review artifacts after a successful first write are still not
  retry authority for a second boundary: if the later boundary is a remapped
  create target, a late-discovered plugin-owned table, or a plugin-owned file
  that was not in the original allowlist, the earlier artifact cannot be
  widened back into success unless that later boundary also got its own
  preserve / reject / retry cycle on live hashes;
- Reprint, ZS-Sync, or ForkPress comparisons: missing proof is the exact
  upstream state plus a rerun of the same live boundary on this branch, not
  route shape, package layout, reviewer wording, fixture replay, or a
  readable review artifact reused as authority; if the comparison does not
  name what the note proves here and what it does not prove here, or it only
  repeats the upstream anchor without a branch-local rerun, it stays
  historical context only and cannot authorize a retry boundary. Matching the
  upstream prose is not enough; the branch-local live boundary, preserved
  remote, and fresh retry scope must all be named.

Missing repo proof for the comparisons is still the same live boundary on
this worktree, rerun against the exact drift case, with:

- preserved-remote evidence after rejection;
- a stale-artifact rejection point before the first write;
- a fresh retry scope rebuilt from live hashes on this branch; and
- old/new/blocked classification for every touched surface, including any
  later-discovered plugin-owned surface.

One more production-gate failure mode still needs explicit wording: a
production-shaped `/wp-json/reprint/v1/push/*` smoke can only prove that the
route is reachable, not that the rejected remote stayed inspectable after
stale drift or that a later-discovered plugin-owned surface was either
enumerated or blocked before write. If the evidence does not name the exact
preserved remote, the exact rejection point, and the later surface boundary,
the smoke remains compatibility evidence and the manual note remains audit
evidence only.

False reliability failure mode to reject:

- a polished note, green smoke, or matching reviewer phrasing can make the
  branch look current without proving the preserved remote, the exact stale-
  drift boundary, or the live retry scope rebuilt from fresh hashes; that
  wording must still fail closed unless it names the exact rejected boundary
  and the exact remote that remained inspectable after rejection on this
  branch;
- "comparison passed" is only production wording if it also says which exact
  upstream state was compared, which exact live boundary was rerun on this
  branch, which preserved remote stayed auditable after drift, and which
  fresh live hashes rebuilt the retry scope; otherwise it is historical
  context, not retry authority; and
- a later-discovered plugin-owned surface, remapped create target, or
  relationship-bearing record cannot inherit authority from an earlier
  readable note just because the route family or package layout is unchanged.

What must change before any production-grade push claim:

- the branch must show a live write boundary that rejects stale remote drift
  before the first mutation, preserves the remote for audit, and rebuilds a
  fresh retry scope from live hashes on this branch;
- the evidence must name the exact stale-drift case and the exact rejection
  point, because a readable manual-resolution note or comparison summary is
  false reliability if it cannot prove the same live boundary was retried
  from fresh live hashes;
- any "manual resolution" outcome must name the exact rejected boundary and
  keep the preserved remote inspectable for audit/retry; if the artifact does
  not prove the same live boundary was retried from fresh live hashes, it is
  only a note, not success;
- the preserved remote must stay separately auditable so a later reviewer can
  inspect the rejected state and retry safely from fresh live hashes; if the
  note cannot point to that preserved remote, it cannot claim production
  success for any later row, file, relationship-bearing record, remapped
  create target, or plugin-owned surface;
- the exact drift case, stale artifact, and fresh live hash set must be named
  in the evidence; a generic "manual resolution" label does not prove the same
  boundary was retried;
- the preserved remote must stay inspectable so the user can audit the drift
  and safely retry from fresh live hashes; preserving it alone is not proof
  unless the same boundary was rejected before write and re-planned on this
  branch;
- any Reprint, ZS-Sync, or ForkPress comparison must name the exact upstream
  revision or worktree state and say what it proves here and what it does not
  prove here before it can be cited for anything beyond historical context;
- create-time identity remapping, aliasing, or renumbering must be either
  proven safe with live identity evidence or hard-blocked before write;
- every touched surface must be classified as old, new, or blocked before
  retry, including mixed file, DB, and plugin side effects, because a mixed
  write cannot be relabeled as success after only the committed part, and any
  later-discovered boundary still needs its own preserve / reject / retry
  cycle;
- every plugin-owned surface outside the allowlist must be enumerated live or
  blocked at apply time, including late-discovered tables, files, cron rows,
  runtime registries, generated assets, caches, and serialized blobs;
- any plugin-owned surface discovered after the first write is a new live
  boundary, not retroactive proof that the earlier manual-review artifact or
  comparison note was correct;
- if a later snapshot reveals a new plugin-owned table, file, registry entry,
  generated asset, cache entry, or serialized blob, that surface becomes a new
  boundary with its own preserve / reject / retry cycle; the earlier artifact
  cannot be widened into retry authority for it;
- a later-discovered plugin-owned surface is never retroactively covered by an
  earlier manual-resolution artifact, even if the route family, package mount,
  or reviewer wording matches; it needs its own live proof or hard block on
  this branch;
- any readable manual-review artifact must stay audit-only after drift and
  cannot become retry authority for a different row, file, relationship-
  bearing record, remapped create target, or plugin-owned surface; and
- source-note comparisons can justify historical design choices, but they do
  not prove the live boundary on this branch unless the exact upstream state,
  the exact stale-drift case, and the same live mutation boundary were
  reverified here with preserved-remote evidence and a fresh retry scope;
- any Reprint, ZS-Sync, or ForkPress note must be treated as historical
  context unless this branch names the exact upstream state from
  `docs/source-notes.md` (`27c5f25`, `d9334a0`, or `55f9879`), reruns the
  same live boundary here, and says what that note proves and does not prove
  here; a note that only matches the same route family, package layout, or
  reviewer wording is still compatibility evidence, not production proof.

Production-grade push support still needs proof for these failure scenarios,
not just wording that sounds conservative:

- live remote drift between dry-run and apply must show the exact rejected
  boundary, the preserved remote, and the fresh retry scope; a fixture replay
  or route-shaped smoke is not the missing proof;
- create-time identity remap, aliasing, or renumbering must either be blocked
  before the first write or proven safe with live identity evidence; a same-ID
  fixture is not proof of the live remap behavior;
- plugin-owned data outside the allowlist, including hidden tables, cron
  rows, runtime registries, generated files, caches, and serialized blobs,
  must be enumerated live or blocked before write; a post-write discovery
  cannot be backfilled into the earlier approval;
- partial file, DB, or plugin side effects must stay old/new/blocked by
  surface before retry; a successful sub-part cannot relabel the mixed write as
  overall success; and
- stale manual-review artifacts must stay audit-only after drift and cannot
  become retry authority for a later row, file, relationship-bearing record,
  remapped create target, or plugin-owned surface unless that later boundary
  also has its own preserve / reject / retry cycle.
- a readable manual-resolution note that only covers the first boundary cannot
  be widened to cover a later-discovered plugin-owned surface or remapped
  create target, even when the later boundary reuses the same route family or
  reviewer wording.

Comparison bottom line: the Reprint note only supports staged transport and
resumability vocabulary, the ZS-Sync note only supports bounded discovery and
cursoring vocabulary, and the ForkPress note only supports audit and crash-
consistency vocabulary. None of them proves a live push executor on this
branch that rejects stale drift before the first write, preserves the remote
for audit, blocks create-time identity remap, or classifies late-discovered
plugin-owned surfaces before retry. If the branch cannot show those
live-boundary proofs here, the source note remains design context only, even
when the upstream state is named precisely or the route/package/reviewer
wording matches. A source note can explain why a design choice exists, but it
cannot by itself prove that this worktree rejected the stale boundary,
preserved the remote, and rebuilt retry scope from live hashes for the same
live mutation boundary. A precise note also cannot become retry authority
unless it names the exact upstream revision or worktree state, the exact live
write boundary on this branch, the exact stale-drift case, and the exact
preserved remote that stayed inspectable after rejection.
If a later-discovered row, file, relationship-bearing record, remapped create
target, or plugin-owned surface is being discussed, the comparison note only
applies if that later boundary was also rerun here with its own preserved-
remote evidence and fresh live hashes; otherwise the earlier note stays
historical context for the earlier boundary only.

Source-note comparison matrix:

- Reprint proves staged pull sequencing and resumability vocabulary, but not
  live push safety, preserved-remote auditability, create-time remap safety,
  or late plugin-owned surface handling on this branch;
- ZS-Sync proves bounded scanning and resource discovery ideas, but not live
  mutation safety, conflict policy, or classification of partial file, DB, or
  plugin side effects before retry here; and
- ForkPress proves audit and crash-consistency vocabulary, but not that a
  readable review artifact stays audit-only after drift, or that the same
  live boundary was rerun on this branch with fresh live hashes.

Those anchors are still insufficient if the branch only shows a matching
route family, package layout, or readable review artifact. For production
wording, the missing proof is branch-local rerun evidence for the same live
drift case, with the rejected remote still inspectable after rejection and a
fresh retry scope rebuilt from live hashes. Without that, `27c5f25`,
`d9334a0`, and `55f9879` stay provenance only, not retry authority.

Conservative comparison rule:

- Reprint `27c5f25` is historical design input for staged transport and
  resumability vocabulary only; it does not prove current stale-drift
  rejection, preserved-remote auditability, or live push safety on this
  branch.
- ZS-Sync `d9334a0` is historical design input for bounded discovery and
  cursoring only; it does not prove current source-mutation safety,
  plugin-owned surface coverage, or retry authority on this branch.
- ForkPress `55f9879` is historical design input for merge review and crash
  consistency vocabulary only; it does not prove that a readable manual
  review can authorize a later row, file, remapped create target, or
  plugin-owned surface on this branch.
- If a comparison note does not say what it proves here and what it does not
  prove here, the note is ambiguous and must fail closed instead of being
  treated as production evidence.

Comparison proof rule: when a source note is cited, the citation must say
which exact upstream revision or worktree state it refers to, whether it is
historical context or live retry proof, and what live boundary was rerun on
this branch. If any of those three pieces is missing, the note is not
production evidence. Route shape, package shape, reviewer wording, readable
manual-review output, and fixture replay all stay compatibility evidence only
unless the same live boundary on this branch also shows preserved-remote
evidence, stale-authority rejection before the first write, a fresh retry
scope rebuilt from live hashes, and old/new/blocked classification for every
touched surface.

Release-gate checklist before any production-grade push wording:

- the exact live boundary on this branch is named, and the exact stale-drift
  case being rejected is named with the preserved remote still inspectable
  after rejection;
- route shape, package mount shape, readable review output, and
  `finalMatchesLocal` are labeled explicitly as compatibility evidence only,
  because a copied or fixture-backed executor can still serve the same shape;
- the first write is blocked or retried only after fresh live hashes rebuild
  the retry scope for that same boundary;
- any create-time identity remap, alias, or renumbering has either live
  identity proof or a pre-write hard block;
- every touched file, DB row, relationship-bearing record, and plugin-owned
  surface is classified old, new, or blocked before retry starts, including
  mixed side effects;
- every plugin-owned surface outside the allowlist is either enumerated live
  before write or blocked at apply time, including late-discovered tables,
  cron rows, runtime registries, generated assets, caches, and serialized
  blobs;
- any readable manual-review artifact is still audit-only unless it names the
  rejected boundary, preserved remote, and fresh retry scope for that same
  live boundary; and
- every Reprint, ZS-Sync, or ForkPress comparison states what the note proves
  here, what it does not prove here, and whether the same live boundary was
  rerun on this branch.

Release gate for the remaining gap:

- any comparison note, readable manual-review artifact, or `finalMatchesLocal`
  result is audit/compatibility evidence only until this branch shows the same
  live boundary with preserved-remote evidence, stale-authority rejection
  before the first write, a retry scope rebuilt from live hashes, and
  old/new/blocked classification for every touched surface;
- any manual-resolution note stays audit-only if it cannot name the rejected
  boundary, prove the preserved remote stayed inspectable after rejection, and
  show a fresh retry scope rebuilt from live hashes for that same boundary;
- any late-discovered plugin-owned surface is a new live boundary, not an
  inherited success case, unless it was explicitly enumerated before write or
  separately blocked with its own preserve / reject / retry cycle; and
- any "manual resolution" claim that does not name the rejected boundary,
  preserved remote, and fresh live-hash retry scope is false reliability, not
  production-grade push support.

Release gate checklist for production wording:

- name the exact live boundary and exact stale-drift case that was rejected;
- show the preserved remote stayed inspectable after rejection so the user can
  audit and retry from fresh live hashes;
- prove the first write was blocked or retried only after the fresh retry
  scope was rebuilt from live hashes on this branch;
- classify every touched file, DB row, relationship-bearing record, and
  plugin-owned surface as old, new, or blocked before retry starts, including
  mixed file/DB/plugin side effects;
- either enumerate every plugin-owned surface outside the allowlist before
  write or block it at apply time, including late-discovered tables, files,
  cron rows, runtime registries, generated assets, caches, and serialized
  blobs;
- state for each Reprint, ZS-Sync, or ForkPress comparison what the note
  proves here, what it does not prove here, and the exact upstream revision
  or worktree state it came from; and
- treat any readable manual-review artifact as audit-only unless it names the
  rejected boundary, preserved remote, and fresh retry scope for that same
  live boundary.

Must change before the project can claim production-grade push support:

- the branch must show the same live boundary rerun on this worktree against
  the exact drift case, with a preserved remote that stays inspectable after
  reject and a fresh retry scope rebuilt from live hashes;
- any manual-resolution wording must stay audit-only unless the exact rejected
  boundary, preserved remote, and fresh retry artifact are all present for
  that same boundary; a readable note alone is not retry authority;
- create-time identity remap, aliasing, or renumbering must be either proven
  safe with live identity evidence or hard-blocked before write;
- every touched surface must be classified old, new, or blocked before retry
  starts, including mixed file, DB, and plugin side effects;
- every plugin-owned surface outside the allowlist must be enumerated live or
  blocked at apply time, including hidden tables, cron rows, runtime
  registries, generated assets, caches, serialized blobs, and any surface
  discovered only after the first write; and
- each Reprint, ZS-Sync, and ForkPress comparison must say what the note
  proves here, what it does not prove here, whether this branch reran the same
  live boundary, and whether any later-discovered plugin-owned surface is in
  scope or explicitly excluded.

Source-note release gate, for avoidance of doubt:

- Reprint source notes prove staged pull vocabulary and transport framing in
  the observed upstream commit. They do not prove this branch has a live push
  executor, preserved-remote auditability after reject, create-time remap
  safety, or late plugin-surface classification.
- ZS-Sync source notes prove bounded discovery and scanning patterns in the
  observed upstream commit. They do not prove this branch enumerates every
  plugin-owned surface before mutation, preserves the remote for audit after
  drift, or rebuilds retry scope from fresh live hashes.
- ForkPress source notes prove audit and crash-consistency vocabulary in the
  observed upstream commit. They do not prove this branch can safely reuse a
  readable review artifact as retry authority for a later boundary, nor do
  they prove preserved-remote rejection on this branch.
- Any note that omits the exact upstream state, the exact live boundary on
  this worktree, and the exact boundary it does not cover is compatibility
  evidence only. It cannot support production-grade push support wording.

Important boundary: a lab-shaped route family, packaged mount, fixture replay,
or `finalMatchesLocal` result can still be compatible without proving the
live executor, preserved remote, or fresh retry scope. Route shape alone is
never production proof here, even if the surface looks production-shaped or
the same path returns live-looking output from a copied or fixture-backed
executor. A production claim must show the exact live boundary, the exact
stale drift case, the exact rejection point, and the exact fresh retry
artifact on this branch; without those pieces, the wording is only
compatibility or design context.
That includes lab/fixture route names that mimic production paths: a matching
URL family can still hide a copied executor, so the claim must also show the
preserved remote, the stale rejection point, and the fresh live-hash retry
scope for the same boundary before any production-grade wording is allowed.
The same warning applies to a readable manual-review artifact or historical
source note: it may prove auditability or provenance, but it does not prove
that the remote was preserved, stale authority was rejected before the first
write, or the retry scope was rebuilt from live hashes for the same live
boundary on this branch.

Anti-trap clarification: a readable manual-review artifact can help audit the
history of a boundary, but it is not retry authority unless the branch also
records the preserved remote, the stale rejection point, and a fresh retry
artifact rebuilt from live hashes for that same live boundary. If a later
plugin-owned table, file, registry entry, generated asset, cache entry, or
serialized blob appears after the first write, that later surface is a new
boundary and needs its own preserve / reject / retry proof.

False reliability rule: a readable review artifact, route-shaped smoke,
packaged-plugin mount, fixture replay, or `finalMatchesLocal` result can only
support compatibility wording. None of them may be promoted to production
reliability unless this branch separately shows the exact live boundary, the
preserved remote after reject, the stale rejection point, and the fresh retry
scope rebuilt from live hashes. If any of those proof points is missing, the
claim must stay audit-only even when the artifact is readable and the route
looks production-shaped.
False reliability also includes any claim that a later-discovered plugin-owned
surface was "already covered" by an earlier readable artifact, because a
hidden table, file, cron row, runtime registry entry, generated asset, cache
entry, or serialized blob that appears after the first write is a new live
boundary and needs its own preserve / reject / retry cycle.

Production-grade claim checklist:

- name the exact stale-drift case, then show the remote was preserved and
  remained inspectable after rejection;
- show the stale approval or manual-review artifact was rejected before the
  first write and cannot widen to a later row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface;
- show any create-time identity remap, aliasing, or renumbering was either
  blocked up front or proven safe with live evidence on this branch;
- classify every touched file, DB row, relationship-bearing record, and
  plugin-owned surface as old, new, or blocked before retry starts, including
  any partial side effects left behind by a failed apply;
- enumerate or block every plugin-owned surface outside the allowlist before
  mutation, including hidden tables, cron rows, runtime registries, generated
  files, caches, serialized blobs, and plugin-owned files that are only found
  after the first write;
- treat any later-discovered plugin-owned surface as a new live boundary with
  its own preserve / reject / retry cycle, not as inherited success from the
  earlier write;
- treat route-shape matches, packaged mounts, fixture replay, readable review
  notes, and `finalMatchesLocal` as compatibility evidence only unless they
  are paired with the same live boundary and the fresh retry artifact rebuilt
  from live hashes; and
- when comparing Reprint, ZS-Sync, or ForkPress, name the exact observed
  upstream state, say what the note proves here, say what it does not prove
  here, and do not treat the comparison as retry authority unless this branch
  reran the same live boundary.

Source-note bottom line: Reprint, ZS-Sync, and ForkPress notes are useful
comparative context, but they do not prove the live executor, the preserved
remote, stale-drift rejection, create-time remap safety, or late-discovered
plugin-owned surface handling on this branch. ForkPress is the most explicit
historical design note about audit and crash-consistency intent, but it is
still only a historical design note here. A note that only matches route
shape, package layout, fixture replay, reviewer wording, or a known upstream
commit is compatibility evidence only, because a copied or fixture-backed
executor can still present the same surface without proving live retry
authority. Even a named upstream state is still historical unless this
branch reran the same live boundary and can show fresh preserved-remote,
rejection-point, and retry evidence for that exact case, plus per-surface
old/new/blocked classification for every touched row, file, relationship-
bearing record, remapped create target, and plugin-owned surface. A later
review rerun does not inherit the earlier note unless it proves that exact
same live boundary again; matching reviewer wording alone never promotes the
older note to current retry authority.

Release-gate checklist for production-grade wording:

- the exact live boundary is named, and the drift case is shown with live
  hashes from this branch rather than inferred from route shape or fixture
  replay;
- any "manual resolution" wording is audit-only unless the same live boundary
  on this branch shows the preserved remote, the stale rejection point, a
  fresh retry scope rebuilt from live hashes, and old/new/blocked
  classification for every touched surface, including any later-discovered
  plugin-owned surface;
- the Reprint, ZS-Sync, and ForkPress notes are cited only as historical
  context unless this branch also reran the same live boundary and can point
  to the preserved remote, rejection point, and fresh retry scope for that
  exact case;
- the rejected remote stays inspectable after the first failed write, so the
  user can audit the drift and retry safely from fresh live hashes;
- the stale approval, readable review artifact, or manual-resolution note is
  marked audit-only for the exact rejected boundary and cannot be reused as
  retry authority for any later row, file, relationship-bearing record, or
  remapped create target;
- every touched surface is classified as old, new, or blocked before retry,
  including file, DB, plugin, cron, registry, generated asset, cache, and
  serialized state;
- every plugin-owned surface outside the allowlist is either enumerated live
  or hard-blocked at apply time, and any later-discovered surface is treated
  as a separate boundary with its own preserve / reject / retry cycle; and
- each Reprint, ZS-Sync, and ForkPress comparison explicitly says what the
  source note proves, what it does not prove, and why it is historical
  context rather than current push proof on this branch.

Do not accept any release-note or review wording as production-grade unless it
also states whether the latest boundary is the same boundary as the earlier
manual resolution, or a new one. If it is a new boundary, the earlier artifact
is audit-only and cannot authorize apply, retry, or comparison success for the
new row, file, relationship-bearing record, remapped create target, or
plugin-owned surface until that later boundary also has its own preserved
remote, stale rejection point, and fresh live-hash retry scope.

Conservative comparison matrix:

- Reprint `27c5f25` proves staged pull delivery, resumable transport, and
  protocol framing in the observed upstream commit. It does not prove a live
  push executor, stale remote-drift rejection, preserved-remote auditability,
  create-time identity remap safety, or later-discovered plugin-owned surface
  handling on this branch.
- ZS-Sync `d9334a0` proves bounded scanning, cursoring, and resource
  discovery in the observed upstream commit. It does not prove source-side
  mutation safety, live-drift rejection, partial-write recovery, create-time
  remap safety, or plugin-owned surface enumeration on this branch.
- ForkPress `55f9879` proves merge-audit vocabulary, reviewed-resolution
  framing, and crash-consistency intent in the observed upstream worktree. It
  does not prove that a readable manual-review artifact can authorize a later
  row, file, relationship-bearing record, remapped create target, or plugin-
  owned surface on this branch.
- Even when the exact upstream state is named, the comparison still does not
  transfer authority to a later boundary on this branch. A later row, file,
  relationship-bearing record, remapped create target, or plugin-owned
  surface still needs its own preserve / reject / retry cycle with live
  hashes, because the earlier note only proves historical context unless this
  worktree reran the same live mutation boundary.
- The missing repo proof for all three is the same live mutation boundary on
  this worktree, rerun against the exact drift case, with preserved-remote
  evidence, stale rejection before the first write, fresh retry scope rebuilt
  from live hashes, and per-surface old/new/blocked classification.

Production-readiness checklist:

- name the exact stale-drift case and the exact live boundary being rerun;
- preserve the remote for audit after rejection, but do not treat that
  preserved remote as retry authority until live hashes rebuild a fresh retry
  scope on this branch;
- reject stale approval or review artifacts before the first write, and prove
  they cannot be widened to a different row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface;
- classify every touched surface as old, new, or blocked before retry starts,
  including mixed file, DB, and plugin side effects;
- enumerate or hard-block every plugin-owned surface outside the allowlist,
  including late-discovered tables, files, cron rows, runtime registries,
  generated assets, caches, and serialized blobs; and
- treat Reprint, ZS-Sync, and ForkPress notes as historical context only
  unless the exact upstream state is named and the same live boundary was
  rerun here with preserved-remote, rejection-point, and fresh retry
  evidence.

Production-grade comparison gate:

- Reprint `27c5f25` only proves staged pull delivery, resumable transport, and
  protocol framing in the observed upstream commit. It does not prove a live
  push boundary, stale remote-drift rejection, preserved-remote auditability,
  create-time identity remapping, partial-write classification, or
  late-discovered plugin-owned surface handling on this branch.
- ZS-Sync `d9334a0` only proves bounded scanning, cursoring, and resource
  discovery in the observed upstream commit. It does not prove source-side
  mutation safety, live-drift handling, partial-write recovery, create-time
  remap safety, or plugin-owned surface enumeration on this branch.
- ForkPress `55f9879` only proves merge-audit vocabulary, reviewed-resolution
  framing, and crash-consistency intent in the observed upstream worktree. It
  does not prove that a manual-review artifact stays audit-only after drift,
  cannot become retry authority for a different row/file/relationship-bearing
  record/remapped create target/plugin-owned surface, or preserve the remote
  while rebuilding retry scope from live hashes on this branch.
- Taken together, the three notes still do not prove production-grade push
  support until this branch names the exact upstream state, reruns the same
  live boundary, and shows preserved-remote, stale-rejection, and fresh
  live-hash retry evidence for the same drift case.
- None of the three notes prove a later-discovered plugin-owned table, file,
  cron row, runtime registry entry, generated asset, cache entry, or
  serialized blob is already covered just because an earlier note used the
  same route family, mount shape, or reviewer vocabulary; that later surface
  is a separate boundary and needs its own preserve / reject / retry proof.
- If a later claim only matches the same route family, package mount, or
  reviewer wording, treat it as compatibility evidence only. A matching shape
  can still hide a copied executor, fixture-backed replay, or stale approval
  being reused after drift.
- Before any production-grade push wording, the branch must show the exact live
  boundary rerun here, the preserved remote after reject, the stale rejection
  point, and the fresh retry scope rebuilt from live hashes; if any one of
  those proof points is missing, the upstream comparison is historical context
  only, even if the note matches the same route family, package mount, or
  reviewer wording.

Non-negotiable release gate:

- no production-grade push claim is allowed unless the branch can name the
  exact drift case, show the preserved remote stayed inspectable after reject,
  and show the retry scope was rebuilt from fresh live hashes on this branch;
- no production-grade push claim is allowed unless every touched surface is
  classified as old, new, or blocked before retry, including mixed file, DB,
  and plugin side effects;
- no production-grade push claim is allowed unless create-time identity
  remap, aliasing, or renumbering is either hard-blocked before write or
  proven with live identity evidence at the apply boundary;
- no production-grade push claim is allowed unless plugin-owned state outside
  the allowlist is enumerated live or hard-blocked, including hidden tables,
  cron rows, runtime registries, generated files, caches, and serialized
  blobs;
- no production-grade push claim is allowed unless later-discovered plugin-
  owned surfaces are treated as separate live boundaries with their own
  preserve / reject / retry cycle;
- no production-grade push claim is allowed if the only new evidence is a
  readable manual-resolution note that names a successful retry but does not
  show the exact rejected boundary, the preserved remote, and the fresh live-
  hash retry scope for the later boundary that actually changed;
- no production-grade push claim is allowed unless stale manual-review
  artifacts stay audit-only after drift and cannot widen to a different row,
  file, relationship-bearing record, remapped create target, or plugin-owned
  surface;
- no production-grade push claim is allowed unless Reprint, ZS-Sync, and
  ForkPress comparisons explicitly state the exact upstream revision or
  worktree state, what each note proves here, what it does not prove here,
  whether this branch reran the same live boundary, and whether any later-
  discovered plugin-owned table, file, registry entry, generated asset, cache
  entry, or serialized blob is explicitly in scope or explicitly excluded;
- no production-grade push claim is allowed unless the same proof set also
  names the exact live boundary, the preserved remote, the stale rejection
  point, the fresh retry scope from live hashes, and the old/new/blocked
  status for every touched surface on this branch; and
- no production-grade push claim is allowed if the evidence rests only on
  route shape, package mount shape, fixture replay, readable manual-review
  artifacts, `finalMatchesLocal`, or a "manual resolution" label without the
  preserved remote, rejection point, and fresh live-hash retry scope.
- no production-grade push claim is allowed if a later-discovered plugin-owned
  surface is being backfilled into an earlier note, because that later surface
  is a separate boundary and the earlier note cannot widen to cover it without
  new live proof on this branch.
- no production-grade push claim is allowed if a readable approval note or
  source comparison is being reused for a later plugin-owned table, cron row,
  runtime registry entry, generated asset, cache entry, serialized blob, or
  remapped create target that was not named in that note; the later boundary
  still needs its own preserve / reject / retry cycle on live hashes.
- no production-grade push claim is allowed if any upstream note is described
  as a proof source instead of historical context, because the branch still
  needs live boundary evidence for stale drift, remapped create targets,
  partial side effects, and late plugin-owned surfaces.

Release-readiness checklist:

- the exact live drift case is named, not implied by a route family or
  fixture name;
- the preserved remote is still inspectable after reject and can be audited
  independently of the retry artifact;
- the stale authority rejection point occurs before the first write;
- the retry scope is rebuilt from fresh live hashes on this branch;
- every touched surface is classified as old, new, or blocked before retry;
- every plugin-owned surface outside the allowlist is either enumerated live
  or hard-blocked at apply time;
- create-time identity remap, aliasing, or renumbering is either proven safe
  with live identity evidence or blocked before write;
- stale manual-review artifacts remain audit-only and cannot widen to another
  row, file, relationship-bearing record, remapped create target, or
  plugin-owned surface; and
- each Reprint, ZS-Sync, or ForkPress comparison states what the note proves,
  what it does not prove, and whether this branch reran the same live
  boundary.

Must change before any production-grade push claim:

- prove the live mutation boundary rejects stale authority before the first
  write, preserves the remote for audit, and rebuilds retry scope from fresh
  live hashes on this branch; without that, "manual resolution" is only a
  post-hoc label, not retry proof;
- prove this branch is using live boundary evidence rather than a lab-shaped
  route family, packaged mount, fixture replay, readable review artifact, or
  `finalMatchesLocal` result that only looks production-shaped while still
  masking a stale remote, remapped create target, or late plugin-owned
  surface; a production-shaped URL family can still be served by a copied or
  fixture-backed executor behind the same path shape, so shape alone is not
  live-write proof;
- prove the claim is rerun on the same live drift case here; a matching
  route family, package mount, fixture replay, readable review artifact, or
  `finalMatchesLocal` result is compatibility evidence only and cannot
  substitute for the branch-local live rerun;
- prove that any Reprint, ZS-Sync, or ForkPress note is being used as
  historical context only unless this branch names the exact upstream state,
  reruns the same live boundary here, and shows the preserved remote,
  rejection point, and fresh retry scope for that exact case; a comparison
  note without that branch-local rerun is not current proof;
- prove any Reprint, ZS-Sync, or ForkPress comparison says whether a later-
  discovered plugin-owned surface is explicitly in scope or explicitly
  excluded, because a note about one boundary cannot silently cover a new
  table, file, registry entry, generated asset, cache entry, or serialized
  blob discovered after the first write;
- prove that a named upstream note cannot be widened to a later-discovered
  plugin-owned surface just because the later surface shares the same route
  family, package mount, or reviewer wording as the earlier note;
- prove that a readable review artifact or historical note cannot become
  retry authority for a later row, file, relationship-bearing record,
  remapped create target, or plugin-owned surface after drift; the missing
  proof is the preserved remote plus the fresh live-hash retry scope for the
  exact same boundary;
- prove a stale approval or readable review artifact cannot be widened into
  a different row, file, relationship-bearing record, remapped create target,
  or plugin-owned surface after drift;
- prove a readable manual-review artifact is audit-only unless the preserved
  remote, rejection point, and fresh retry scope are all recorded on this
  branch for the same live boundary;
- prove a manual-resolution label never becomes success by itself; it is only
  audit context until the remote is preserved, the stale approval is rejected
  before mutation, and the fresh retry scope is rebuilt from live hashes;
- prove a later-discovered plugin-owned surface does not inherit the earlier
  manual-resolution label, because a hidden table, generated file, cron row,
  runtime registry entry, cache entry, or serialized blob that appears after
  the first write is a new live boundary and must get its own preserved
  remote, rejection point, and fresh retry scope; the preserved remote from
  the earlier boundary does not widen to that later surface;
- enumerate or hard-block late-discovered plugin-owned state, including
  custom tables, generated files, cron rows, runtime registries, serialized
  blobs, cache entries, and other hidden side effects; and
- classify partial file, DB, and plugin side effects as old, new, or blocked
  before retry so a mixed write cannot be relabeled as success.
- reject any wording that treats a readable comparison note or route-shaped
  smoke as current retry authority unless the preserved remote, rejection
  point, and fresh retry scope are all recorded on this branch for the exact
  same boundary.
- reject any wording that says "manual resolution" succeeded when the remote
  was not preserved for audit, the stale approval was not rejected before
  mutation, or the fresh retry scope was not rebuilt from live hashes for the
  same boundary;
- reject any wording that treats a later plugin-owned table, file, registry
  entry, generated asset, cache entry, or serialized blob as covered by the
  earlier boundary unless that later surface has its own preserve / reject /
  retry evidence on this branch; and
- reject any wording that promotes a Reprint, ZS-Sync, or ForkPress note to
  current proof unless the exact upstream revision or worktree state is named
  and the same live boundary was rerun here with preserved-remote evidence.
- reject any wording that says "manual resolution later" succeeded when the
  remote was not preserved, the stale approval was not rejected before the
  first write, or the fresh retry scope was not rebuilt from live hashes for
  the same live boundary; a readable artifact after drift is audit evidence,
  not retry authority.
- reject any wording that widens one boundary to a later-discovered plugin-
  owned surface, remapped create target, file, row, or relationship-bearing
  record just because the later surface shares the same URL family or review
  text; the later surface needs its own preserve / reject / retry cycle.

Operational release gate:

- before any production wording, the branch must show the exact live write
  boundary, the preserved remote after reject, the stale rejection point, and
  the fresh retry artifact rebuilt from live hashes on this worktree;
- the branch must separately classify any late-discovered plugin-owned
  surface, because a hidden table, generated file, cron row, cache entry, or
  runtime registry that appears after the first write is a new boundary, not
  proof that the earlier approval was safe;
- a readable manual-review artifact stays audit evidence only until the
  branch proves it cannot become authority for a different row, file,
  relationship-bearing record, remapped create target, or plugin-owned
  surface after drift; and
- route shape, package mount shape, fixture replay, readable review output,
  and `finalMatchesLocal` remain compatibility evidence only unless the same
  live boundary was revalidated on this branch with preserved-remote proof;
  shape alone does not show the live executor, auth path, or write boundary.

Hard stop on proof substitution:

- a readable manual-review artifact, source-note comparison, or production-
  shaped route name must never be treated as current retry authority unless
  this branch also shows the exact live drift case, the preserved remote,
  the stale rejection point, and a fresh retry scope rebuilt from live
  hashes; if any one of those branch-local proofs is missing, the comparison
  remains historical context only, even when the upstream note is correctly
  cited and the route family looks production-shaped.

Source-note comparison rule:

- Reprint, ZS-Sync, and ForkPress notes are historical context unless the
  exact upstream commit or worktree state is named and this branch reran the
  same live mutation boundary with preserved-remote evidence;
- naming the upstream revision is provenance, not proof: a cited note can
  still describe a copied executor, fixture-backed route, or review-only
  replay that never exercised the live write path on this branch;
- even when the upstream revision is named correctly, the comparison still
  fails closed unless this branch revalidated the same live boundary here;
- even when the upstream revision is named correctly, the note still cannot
  become current retry authority until this branch shows the preserved
  remote, the rejection point, and the fresh retry scope for the exact same
  live boundary;
- the observed source-note anchors in `docs/source-notes.md` are `27c5f25`
  for Reprint, `d9334a0` for ZS-Sync, and `55f9879` for ForkPress; those
  commits support transport, discovery, and review vocabulary respectively,
  but they still do not prove live write safety, stale-drift rejection, or
  retry authority on this branch;
- route-shape smokes, package mounts, fixture replays, readable review
  artifacts, and `finalMatchesLocal` remain compatibility evidence only even
  when they look production-shaped; and
- a comparison cannot become retry authority unless the preserved remote, the
  rejection point, and the fresh retry scope are recorded on this branch for
  the same boundary.

Conservative upstream comparison summary:

- Reprint only supports staged transport and resumability vocabulary. It does
  not prove live push safety, remote preservation after drift, identity
  remapping on create, plugin-owned allowlist coverage, or mixed-write
  classification on this branch.
- ZS-Sync only supports bounded discovery and resource-scanning vocabulary.
  It does not prove source-site mutation, live drift rejection, hidden
  plugin-state discovery, or retry authority for a live write boundary.
- ForkPress only supports review and recovery vocabulary. It does not prove
  that a readable manual-review artifact stays audit-only after drift, that
  stale approval cannot be widened to a later boundary, or that this branch
  preserved the remote while rebuilding retry scope from fresh live hashes.

Known data-loss traps still unresolved:

- a live remote can drift between preflight and apply, and the branch still
  needs proof that stale authority fails before the first write while the
  remote remains auditable for retry. Missing proof: a branch-local live rerun
  with the drifted remote, rejection point, and fresh retry hashes recorded
  together;
- create-time identity can be remapped, aliased, or renumbered, and the
  branch still needs proof that the create target is either preserved or
  blocked before write, not just that the local plan still names the same
  logical resource. Missing proof: live identity evidence or a hard block
  before mutation;
- plugin-owned state can exist outside any allowlist in late tables, files,
  cron rows, runtime registries, generated assets, caches, and serialized
  blobs, and the branch still needs live enumeration or an explicit block for
  each surface, including surfaces discovered only after the first write.
  Missing proof: a complete live inventory or hard block for every surface;
- a write can touch files, DB rows, and plugin state in one run, and the
  branch still needs old/new/blocked classification for the full mixed write
  path instead of success for only the committed part. Missing proof:
  durable old/new/blocked classification for every touched surface before
  retry; and
- a readable review artifact, comparison note, or route-shaped smoke can look
  authoritative while still failing to prove current retry authority for the
  exact live boundary on this branch, especially when it can be reused as
  authority for a different row, file, relationship-bearing record, remapped
  create target, or plugin-owned surface after drift.

Release wording must treat the following as false reliability unless the
branch also shows the preserved remote, the stale rejection point, and the
fresh retry scope rebuilt from live hashes on this worktree:

- "manual resolution succeeded" when the readable artifact could still be
  reused after drift;
- "production-grade push support" when the only proof is route shape,
  package mount shape, fixture replay, or `finalMatchesLocal`;
- "plugin-safe push" when hidden plugin-owned tables, files, cron rows,
  runtime registries, generated assets, caches, or serialized blobs are not
  separately enumerated or blocked, including late-discovered surfaces that
  appear only after the first write; and
- "comparison passed" when the comparison only matches upstream route family,
  package layout, or reviewer wording without a branch-local live rerun; and
- "manual resolution later" when a readable artifact is merely preserved for
  audit, because preservation alone does not prove the remote stayed valid
  for retry or that the same boundary was rerun from fresh live hashes.

Claim substitution rule:

- do not substitute route shape, package mount shape, fixture replay,
  readable review output, or `finalMatchesLocal` for live retry proof;
- do not substitute a cited Reprint, ZS-Sync, or ForkPress note for current
  proof unless the exact upstream state and the branch-local live rerun are
  both named, and the same boundary is shown to preserve the remote, reject
  stale authority, and rebuild retry scope from fresh live hashes;
- do not substitute a readable manual-review artifact for retry authority
  when a later row, file, relationship-bearing record, remapped create
  target, or plugin-owned surface appears after drift; and
- do not substitute a preserved remote for success unless the branch also
  shows the stale rejection point and the fresh retry artifact for that exact
  boundary on this worktree.

Release-gate checklist:

- name the exact live write boundary and the exact stale-drift case rerun on
  this worktree;
- show the preserved remote stayed auditable after reject, and show the retry
  was rebuilt from fresh live hashes instead of inherited from the earlier
  approval;
- show that a readable manual-review artifact or source-note comparison stays
  audit-only for any later-discovered plugin-owned surface unless that later
  surface has its own preserve / reject / retry evidence on this branch,
  even if the later boundary reuses the same route family, package mount, or
  reviewer wording, and even if the earlier remote was preserved for audit;
- show that preserving a readable review artifact never widens its scope to a
  later-discovered plugin-owned surface, because that later surface still
  needs its own preserve / reject / retry cycle even if the earlier artifact
  survives drift;
- show the stale approval, review artifact, or source-note comparison cannot
  authorize a later row, file, relationship-bearing record, remapped create
  target, or plugin-owned surface, and cannot be widened just because the
  later boundary looks like the earlier one;
- show that a lab-shaped or fixture-backed route family still fails the gate
  unless the branch also proves the live executor, preserved remote, stale
  rejection point, and fresh retry scope on this worktree;
- fail closed if the only apparent proof is route shape, package mount shape,
  fixture replay, readable review output, or `finalMatchesLocal`; those are
  compatibility signals only, not live retry proof;
- classify every touched surface as old, new, or blocked before retry starts,
  including any late-discovered plugin-owned table, file, registry entry,
  cache entry, generated asset, or serialized blob;
- require any Reprint, ZS-Sync, or ForkPress comparison to name the exact
  upstream revision or worktree state, the exact live boundary rerun here,
  and the exact proof boundary it does and does not cover, including whether
  a later-discovered plugin-owned surface is in scope or explicitly excluded;
- require any Reprint, ZS-Sync, or ForkPress comparison to state whether it
  proves only historical compatibility or current retry authority on this
  branch;
- require any Reprint, ZS-Sync, or ForkPress comparison to say whether a
  later-discovered plugin-owned surface is in scope or explicitly excluded;
- require any later-discovered plugin-owned surface to get its own preserve /
  reject / retry record on this branch, because the earlier audit trail cannot
  be widened into authority for a new table, file, registry entry, generated
  asset, cache entry, or serialized blob; and
- require any manual-resolution label to fail unless the remote is preserved
  for audit, the stale artifact is rejected before mutation, and the fresh
  retry scope is rebuilt from live hashes on this branch.

Minimal production proof pack:

- exact live boundary, drifted remote, and rejection point for the stale
  attempt;
- preserved remote evidence that remains auditable but does not itself confer
  retry authority;
- fresh retry artifact rebuilt from live hashes on this branch;
- old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface; and
- one explicit scope statement for any later-discovered plugin-owned surface,
  including whether it is separately blocked or separately rerun.

False reliability claims to reject:

- "production-grade push support" when the branch only shows compatibility
  evidence, a readable review note, or a preserved route shape but not a
  live rejection point plus a fresh retry artifact on this branch;
- "manual resolution succeeded" when the remote is not preserved for audit,
  the stale artifact can still be reused, or the user cannot safely retry
  from fresh live hashes;
- "plugin-safe push" when plugin-owned tables, files, registries, caches,
  generated assets, cron rows, or serialized blobs outside the allowlist
  are not enumerated, blocked, or separately classified; and
- "comparison passed" when the comparison note is historical only and does
  not rerun the same live boundary with preserved-remote evidence.

The following wording must fail closed unless the branch shows the same live
boundary, preserved remote, and fresh retry scope on this worktree:

- "manual resolution succeeded" when the preserved remote is missing, the
  stale artifact can still be reused, or the fresh retry artifact was not
  rebuilt from live hashes;
- "plugin-safe push" when the allowlist misses hidden tables, cron rows,
  runtime registries, generated files, serialized blobs, caches, or
  plugin-owned files that only appear after the first write;
- "comparison passed" when the comparison is only a Reprint, ZS-Sync, or
  ForkPress note with no exact upstream revision/worktree state and no live
  rerun on this branch;
- "production-grade" when any late-discovered plugin-owned surface is folded
  into an earlier success story without its own preserve/reject/retry cycle;
  and
- "retry-safe" when a readable review artifact, route-shaped smoke, package
  mount, fixture replay, or `finalMatchesLocal` result is being used as
  retry authority instead of compatibility evidence.

The missing proof is not just "the route works" or "the reviewer can
manually inspect the result." The branch still needs live evidence that the
preserved remote survives reject, that stale approval cannot be widened into a
new boundary, and that every touched surface has a durable old/new/blocked
classification before the next retry starts. If a later plugin-owned surface
appears after the first write, the branch must show a separate preserve /
reject / retry cycle for that later boundary; the earlier manual-review note
cannot be reused as authority for it.

Required proof pack before the claim can move from compatibility wording to
production wording:

- the exact live write boundary and drifted remote that failed closed here;
- the preserved remote evidence that stayed auditable after reject;
- the rejection point that made the stale approval or review artifact unusable
  as retry authority;
- the fresh retry artifact on this branch, rebuilt from live hashes rather
  than copied from the earlier approval;
- the classification for every touched row, file, relationship-bearing record,
  and plugin-owned surface as old, new, or blocked; and
- the exact upstream revision or worktree state for every Reprint, ZS-Sync, or
  ForkPress comparison, plus what that note proves here and what it does not
  prove.

Additional proof gaps that still need to be closed:

- prove create-time identity remapping is either blocked before write or
  recorded with live identity evidence, not just a fixture that preserves the
  same ID while the live remote could still renumber or alias the target;
- prove any Reprint, ZS-Sync, or ForkPress note is treated as historical
  context unless the exact upstream revision or worktree state is named and
  the same live boundary is rerun here with preserved-remote evidence;
- prove the exact Reprint, ZS-Sync, and ForkPress source-note anchors from
  `docs/source-notes.md` are only being used as historical comparison
  evidence, not as current proof for this branch's live write boundary;
- prove plugin-owned state outside the allowlist is discovered live or
  rejected live, including hidden tables, generated files, cron rows, runtime
  registries, serialized blobs, cache entries, and activation-sensitive
  side effects;
- prove the stale review artifact cannot become retry authority for a new
  boundary after drift, including a different row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface; and
- prove the branch can preserve the remote, reject the stale boundary, and
  rebuild fresh retry scope even when a late plugin-owned surface appears only
  after the first write.

Production-grade push support also needs an explicit anti-trap rule: if the
first write lands and a later snapshot exposes a plugin-owned table, file,
registry entry, generated asset, cache entry, serialized blob, or other
plugin-owned data trap that was not part of the original live boundary, that
later surface is a new boundary. It is not acceptable to fold that surface
into the earlier "manual resolution" story, or reuse the earlier readable
review artifact as retry authority, unless the preserve/reject/retry proof is
repeated for that later surface on this branch.
Manual resolution is therefore an audit trail, not a release gate, unless the
branch can show the preserved remote, the rejection point, and the fresh
retry artifact for the exact same boundary.
If the preserved remote cannot still be audited and retried safely from fresh
live hashes, the branch has not proven production-grade recovery even when
the review artifact remains readable.

Source-note comparisons are still only historical context unless this branch
names the exact upstream revision or worktree state and reruns the same live
mutation boundary here. A Reprint, ZS-Sync, or ForkPress note can justify
transport shape, discovery shape, or review vocabulary, but it does not
prove this branch preserved the remote, rejected the stale artifact before
mutation, or rebuilt retry authority from fresh live hashes. If the claim
only shows a route-shaped smoke, packaged mount, fixture replay, readable
manual-review artifact, or `finalMatchesLocal`, the comparison remains
non-authoritative for production wording. Even a correctly named upstream
commit stays historical unless this branch replays the same live boundary and
preserves the remote for audit.
Even when the exact upstream revision is named, the note stays historical
unless this branch also rechecked the same live boundary here, preserved the
remote after reject, and separately proved any late-discovered plugin-owned
surface was blocked or classified before retry. Provenance plus route family
is not enough to become current retry authority.

Comparison-specific release gate:

- The comparison must name the exact upstream commit or worktree state and
  the exact live boundary on this branch that was rerun.
- The comparison must say what the cited Reprint, ZS-Sync, or ForkPress note
  proves here and what it does not prove.
- The comparison must show the preserved remote, the stale-authority
  rejection point, and the fresh retry scope rebuilt from live hashes.
- The comparison must separately account for any late-discovered plugin-owned
  surface; if that surface was not independently blocked or classified, the
  comparison remains historical context only.
- The comparison must not promote route shape, package mount shape,
  fixture replay, readable review output, or `finalMatchesLocal` into retry
  authority.

Concrete failure scenarios that still disqualify production wording:

- Live remote drift: dry-run succeeds, the remote changes before apply, and
  the first write still lands because the stale approval artifact was treated
  as retry authority. The missing proof is a live rejection point that
  preserves the remote for audit and forces fresh hashes before retry.
- Late-discovered plugin-owned surface: the first write lands on an allowlisted
  row or file, then a hidden custom table, cron row, runtime registry entry,
  generated file, serialized blob, or plugin-owned cache entry appears on the
  next live snapshot. The missing proof is a separate rejection or
  classification point for that later boundary, plus a preserved remote and
  fresh retry scope on this branch; without that, the earlier approval can be
  widened into a second write that was never actually audited.
- Create-time identity remapping: a create target is renamed, aliased, or
  renumbered between planning and apply, and the write lands on the wrong
  row, file, or relationship-bearing record. The missing proof is a live
  identity check that either blocks the remap or classifies the new target
  before any mutation.
- Plugin-owned state outside the allowlist: a hidden custom table, cron row,
  runtime registry entry, generated file, serialized blob, cache entry, or
  plugin-owned file appears after the first write. The missing proof is a
  complete live inventory or a hard block on the newly discovered surface.
- Partial file, DB, or plugin side effects: one part of the write commits and
  another part fails or drifts, then the surviving partial state is later
  relabeled as success. The missing proof is a durable old/new/blocked
  classification for every touched surface before retry scope is rebuilt.
- Stale manual-review artifacts: a readable review note, approval token, or
  comparison result is reused after drift to justify a second boundary. The
  missing proof is preserved remote evidence plus a fresh branch-local retry
  artifact for the same live boundary; readability alone is audit evidence,
  not retry authority, and it cannot be widened to a later row, file, or
  plugin-owned surface.
- Release-language failure rule: any "production-grade push support" claim
  must fail if it relies on a readable review artifact, comparison note, or
  route-shaped smoke that was not rebuilt from live hashes on this branch;
  the artifact may remain readable for audit, but it cannot authorize a
  different row, file, relationship-bearing record, remapped create target,
  or plugin-owned surface after drift.
- False reliability from source-note comparisons: a Reprint, ZS-Sync, or
  ForkPress note is cited as if it proved this branch's live executor. The
  missing proof is the branch-local rerun of the same live boundary, the
  preserved remote, the stale rejection point, and a fresh retry scope built
  from live hashes on this worktree.
- False reliability from lab-shaped proof: route shape, package mount shape,
  fixture replay, readable review output, or `finalMatchesLocal` is treated
  as production safety. The missing proof is live rejection of stale
  authority before mutation and a retry scope that was rebuilt from fresh
  live evidence.

Conservative comparison summary:

- Reprint proves staged transport rhythm, resumable delivery structure, and
  protocol framing. It does not prove live source mutation safety, remote
  preservation after drift, create-time remap handling, plugin-owned surface
  coverage, partial-write classification, or any live write-boundary proof on
  this branch.
- ZS-Sync proves bounded discovery, cursoring, and resource listing. It does
  not prove write permission, live remote drift rejection, late plugin-owned
  surface detection, identity remapping safety, or any retry authority on a
  live mutation boundary.
- ForkPress proves reviewed-resolution vocabulary, crash-consistency intent,
  and plugin-aware merge modeling. It does not prove that a readable manual
  review artifact stays audit-only after drift, that stale approval cannot be
  reused for a later boundary, or that this branch preserved the remote while
  rebuilding retry scope from fresh live hashes on the actual write path.

Historical comparison summary:

- Reprint is the most explicit source for staged transport and resumability,
  but its notes only illustrate push transport shape here. They do not prove
  live mutation safety, identity remap handling, plugin-owned data discovery,
  or partial-write classification on this branch.
- ZS-Sync is useful for scanner/resource batching and cursoring, but it only
  illustrates bounded discovery and does not prove write authorization,
  stale-drift rejection, or retry authority after a live remote changes.
- ForkPress is the most explicit source for conflict vocabulary and durability
  language, but it still only illustrates review framing. It does not prove
  that a readable review artifact can be reused safely after drift, or that
  hidden plugin-owned state outside the allowlist is blocked before retry.

Most important unresolved trap:

If the first write succeeds on a narrower surface and a later live snapshot
reveals an additional plugin-owned row, file, registry entry, generated asset,
cache entry, or other hidden side effect, that later surface is a new
mutation boundary. The design is still missing proof that this branch can
preserve the remote for audit, reject the stale approval at the new boundary,
and rebuild retry scope from fresh live hashes without widening the old
approval into the new surface. Until that is shown, "manual resolution"
language can still conceal a second-write data-loss path.

Three production claims still need to be rejected explicitly:

- "manual resolution succeeded" is not production proof unless the drifted
  remote is still preserved for audit, the stale approval cannot be reused
  as retry authority, and the user can inspect and retry from fresh live
  evidence on this branch;
- "manual resolution succeeded" is also not production proof if the preserved
  remote cannot still be inspected to support a safe retry from fresh live
  hashes for the same boundary;
- "plugin-safe push" is not production proof unless plugin-owned state
  outside the allowlist is enumerated or hard-blocked at apply time,
  including late-discovered rows, files, registries, generated assets,
  custom tables, cache entries, and serialized blobs; and
- "compatibility passed" is not production proof when it comes from route
  shape, package mount shape, fixture replay, `finalMatchesLocal`, or a
  readable review artifact, because those only show that a lab-shaped path
  still looks compatible.

Do not let lab-shaped success stand in for live proof. A production-shaped
route, package mount, fixture replay, or `finalMatchesLocal` result can still
come from a copied executor behind the same URL family; that is compatibility
evidence, not proof that the live write path rejected stale authority before
mutation, preserved the remote for audit, or rebuilt retry scope from fresh
live hashes. In particular, a lab route shape that returns the right hashes
or route family does not prove the live executor ran, does not prove the
remote drift was rejected before the first write, and does not prove retry
authority was rebuilt from fresh live evidence. The same limit applies to any
readable manual-review artifact and any Reprint, ZS-Sync, or ForkPress
citation: unless this branch reran the same live mutation boundary against
the same drift case and recorded the preserved remote, rejection point, and
fresh retry scope, the artifact or citation remains historical only. If a
later snapshot exposes a new plugin-owned surface, the earlier artifact stays
audit-only and cannot authorize that second boundary unless the preserve /
reject / retry proof is repeated for the new surface on this branch.
That warning also covers route-shaped smokes that happen to return live-looking
hashes or inspectable review output: a matching surface can still mask a stale
remote, a remapped create target, or a late plugin-owned surface that only
appears after the first write. A readable approval that covered the first write
does not prove the second boundary is safe; if a later plugin-owned surface or
remapped identity appears after that first success, the old artifact remains
audit-only and cannot be widened into retry authority for the new boundary.
The same rule applies to comparison notes: unless the exact upstream revision
or worktree state is named and this branch reran the same live boundary, the
note is provenance only and cannot become current retry authority.
If that note or review artifact is the only proof, it is still not enough to
claim production-grade push support because it does not show the preserved
remote, the stale rejection point, or the fresh retry scope for the live
write path on this branch.

One concrete failure mode still needs to be named more sharply: if the first
write succeeds and a late plugin-owned surface appears on the next live
snapshot, then any earlier approval, review artifact, or source-note
comparison is stale by definition. The branch must prove that this second
surface is either blocked or separately classified before retry, and the
proof must show the preserved remote, the rejection point for the late
surface, and the fresh retry scope on this branch. Without that, a clean first
write can still hide a second-write data-loss path behind "manual resolution"
language.

Production-readiness language checklist:

1. Name the exact live mutation boundary, the exact drifted remote, and the
   exact rejection point before mutation.
2. Show the preserved remote stayed auditable after reject and the stale
   approval could not be reused as retry authority.
3. Show the retry artifact is fresh on this branch and was rebuilt from live
   hashes, not inherited from the old review token.
4. Classify every touched row, file, relationship-bearing record, and
   plugin-owned surface as old, new, or blocked before retry starts.
5. Explicitly list any late-discovered plugin-owned surface and prove it was
   blocked or separately classified, not folded into the earlier success
   story.
6. Treat Reprint, ZS-Sync, and ForkPress notes as historical context unless
   the exact upstream revision or worktree state is named and the same live
   boundary was rechecked here with preserved-remote evidence.
7. Treat route shape, package mount, fixture replay, readable review
   artifacts, and `finalMatchesLocal` as compatibility evidence only.
8. Fail closed if the wording says "manual resolution" but does not also show
   the preserved remote, the stale rejection point, and the fresh retry
   artifact on the same live boundary.
9. Treat "manual resolution" as audit-only unless the preserved remote stays
   inspectable, the stale rejection point is recorded, and the retry artifact
   is fresh on this branch for the same boundary.

Conflict boundary rule:

- if a later live snapshot exposes a new plugin-owned row, file, registry
  entry, generated asset, cache entry, or serialized blob, that surface is a
  new mutation boundary, not a continuation of the earlier approval;
- the earlier readable review artifact stays audit-only for that new
  boundary even if it remains readable, route-shaped, or compatible with the
  prior note;
- the branch must record a fresh preserve/reject/retry cycle for the new
  surface before any wording can call it resolved; and
- manual resolution is not success for the new boundary unless the preserved
  remote, the rejection point, and the fresh retry artifact are all present
  on this branch for that later surface.
10. Treat any later-discovered plugin-owned surface as a new boundary unless
    the branch proves it was blocked or separately classified before retry;
    do not fold it into the first write's success story.
11. Treat route shape, package mount shape, fixture replay, and
    `finalMatchesLocal` as compatibility checks only; they do not prove the
    live executor ran, the remote was preserved, or the retry scope was
    rebuilt from fresh hashes.
12. Treat a lab-shaped route or mount as unable to hide a later plugin-owned
    surface that appears only after the first write; if that later table,
    file, registry entry, generated asset, cache entry, or serialized blob
    was not separately blocked or classified, the earlier success story is
    not production-grade.
13. Treat Reprint, ZS-Sync, and ForkPress comparisons as historical context
    unless the exact upstream revision or worktree state is named and this
    branch reran the same live mutation boundary here.
14. Treat any readable review artifact or comparison note as audit evidence
    only unless it is paired with the preserved remote and a fresh retry
    artifact on the same live boundary; readability alone is not retry
    authority.
15. Treat any late-discovered plugin-owned surface as a new boundary unless
    the branch proves it was blocked or separately classified with its own
    preserved remote and fresh retry artifact.
16. Treat partial file/DB/plugin side effects as data-loss risk unless every
    touched surface is durably marked old, new, or blocked before retry.

Release gate for production wording:

- A production-grade push claim must fail if the proof only shows a route-
  shaped smoke, package mount shape, fixture replay, readable review note,
  or `finalMatchesLocal` result without a branch-local live rejection point.
- A production-grade push claim must fail if the first write succeeded but a
  later live snapshot exposed a remapped create target, hidden plugin-owned
  row, file, registry entry, generated asset, serialized blob, or cache
  entry that was not separately blocked or classified before retry.
- A production-grade push claim must fail if the remote is not preserved for
  audit after reject, if the stale approval can be reused as retry authority,
  or if the retry artifact is not fresh on this branch and rebuilt from live
  hashes.
- A production-grade push claim must fail if "manual resolution" is used
  without the preserved remote, the rejection point, and the fresh retry
  artifact for the same live boundary, because that label can otherwise hide
  a widened second boundary to a different row, file, relationship-bearing
  record, remapped create target, or later plugin-owned surface.
- A production-grade push claim must fail if any touched row, file, relation-
  bearing record, or plugin-owned surface is left unclassified before retry
  scope is rebuilt.
- A production-grade push claim must fail if create-time identity remap is
  only shown through a fixture that keeps the same ID while the live remote
  could have renumbered, aliased, or reassigned the target.
- A production-grade push claim must fail if any Reprint, ZS-Sync, or
  ForkPress note is used as current proof without naming the exact upstream
  revision or worktree state and rerunning the same live boundary here.
- A production-grade push claim must fail if "manual resolution" is used as
  a success label without the preserved remote, the rejection point, and the
  fresh retry artifact all recorded for the same live boundary.
- A production-grade push claim must fail if a readable manual-review
  artifact, review token, or comparison note is treated as sufficient proof
  on its own, because readability only proves the artifact can be inspected;
  it does not prove the remote stayed preserved, the stale authority was
  rejected before mutation, or the retry scope was rebuilt from fresh live
  hashes on this branch.
- A production-grade push claim must fail if route shape, package mount
  shape, fixture replay, or `finalMatchesLocal` is used to justify plugin
  allowlist completeness, because those checks can still miss hidden
  plugin-owned tables, files, cron rows, runtime registries, generated
  assets, caches, or serialized blobs that appear only after the first write.
- A production-grade push claim must fail if a readable manual-review
  artifact is reused after drift to authorize a different row, file,
  relationship-bearing record, remapped create target, or later plugin-owned
  surface; the artifact may remain auditable, but it cannot become retry
  authority for a new boundary without its own preserved remote, rejection
  point, and fresh retry artifact on this branch.
- A production-grade push claim must fail if a later plugin-owned surface is
  treated as covered by the earlier approval just because it shares the same
  route family, package mount, or reviewer wording; that later surface is a
  new boundary and needs its own preserve / reject / retry proof.

Source-note comparison policy:

- Reprint source notes may justify the overall push shape because they cover
  staged transport rhythm, resumable pull structure, and a production push
  protocol direction. They do not prove this branch's live write path,
  preserved-remote retry, create-time remap handling, plugin-owned coverage,
  or partial-write classification unless this branch reran the same live
  boundary and recorded the proof here.
- ZS-Sync source notes may justify continuous scanning, bounded discovery,
  and cursoring. They do not prove safe mutation, remote preservation after
  drift, identity remapping, or plugin-owned allowlist coverage unless the
  same live write boundary was rechecked here.
- ForkPress source notes may justify reviewed-resolution vocabulary and a
  crash-consistency target. They do not prove production push support on this
  branch unless the same drifted remote, preserved remote, and fresh retry
  scope were rerun and recorded here.
- Any Reprint, ZS-Sync, or ForkPress citation is historical context unless
  the exact upstream revision or worktree state is named and this branch
  reran the same live mutation boundary on this repo.
- The exact upstream revisions used elsewhere in this audit are historical
  anchors only: Reprint `27c5f25`, ZS-Sync `d9334a0`, and ForkPress
  `55f9879`. They describe upstream source-note context, not current
  branch-local proof, and they do not establish safe retry authority unless
  this branch reran the same live boundary and recorded the preserved remote,
  rejection point, and fresh retry scope here.
- Any note that names the right family but omits the exact upstream revision
  or worktree state remains provenance only, even if it matches route shape,
  package mount shape, or a readable review artifact.
- Any note that merely matches the same route family, package layout, or
  reviewer wording still remains provenance only; similarity to the design
  family does not prove the live rejection point, preserved remote, or fresh
  retry scope on this branch.
- Even when the exact upstream revision is named, a source note is still not
  current proof unless this branch reran the same live mutation boundary and
  separately proved any late-discovered plugin-owned surface was blocked or
  classified before retry. Provenance plus family match is not enough.

One weak claim still worth tightening explicitly: a production-shaped route,
package mount, or fixture can still be a copied-lab executor behind the same
URL family. That means a green smoke, `finalMatchesLocal`, matching mount
shape, or route-shaped replay must never be presented as proof that the live
source executor rejected stale authority before mutation, preserved the
remote for audit, or rebuilt retry scope from fresh live hashes. A readable
manual-review artifact has the same limit: if the preserved remote, rejection
point, and fresh retry scope are not all recorded on the same live boundary,
the artifact is audit-only and cannot become retry authority. The same rule
applies to upstream citations: a matching Reprint, ZS-Sync, or ForkPress
commit can justify the design direction, but without a branch-local live
recheck it stays historical input only.

The missing proof is still branch-local and live, and every one of these gaps
has a concrete failure scenario:

- a drifted remote has to fail closed on the actual mutation boundary, with
  the preserved remote auditable after reject and the stale approval unusable
  for retry; otherwise a post-dry-run remote change can be overwritten under a
  still-readable approval artifact;
- a readable approval, review artifact, or comparison note must never become
  retry authority for a different row, file, relationship-bearing record, or
  plugin-owned surface after drift; otherwise the claim hides a second-write
  data-loss mode behind “manual resolution” language;
- a later-discovered plugin-owned surface must not be folded into the same
  success story as the first write, even if the first write committed cleanly;
  the proof has to keep the preserved remote, the blocked or classified late
  surface, and the fresh retry scope separate, or the second write is a new
  boundary with no production safety evidence;
- a source-note comparison for the first write must not be treated as partial
  evidence for a late-discovered plugin-owned surface; if a hidden cron row,
  custom table, generated asset, runtime registry entry, or serialized blob
  appears after the first write, the earlier comparison stays historical only
  and cannot authorize that later boundary unless this branch separately
  preserved the remote, rejected the stale authority, and rebuilt retry scope
  from fresh live hashes on that new surface;
- a readable comparison note or review artifact must not be reused as retry
  authority for a later plugin-owned surface that appears after the first
  write; the later hidden table, file, registry entry, generated asset,
  cache entry, or serialized blob is a new boundary and needs its own
  preserved remote, rejection point, and fresh retry scope on this branch;
- a later-discovered plugin-owned surface must not be treated as a harmless
  continuation of the same success path after the first write; if it appears
  after the first mutation, the branch needs a separate rejection or
  classification point and preserved remote, otherwise the hidden second write
  can bypass the earlier approval and become an unreviewed data-loss path;
- "manual resolution" only counts when the remote is preserved for audit,
  the retry is recorded as a fresh artifact on this branch, and the stale
  approval cannot be widened to another row, file, relationship-bearing
  record, or plugin-owned surface;
- create-time identity remapping has to be either durably proven or hard-
  blocked before mutation, including alias, rename, and renumber cases;
  otherwise a create can land on the wrong identity after a live remap;
- plugin-owned state outside the allowlist has to be enumerated or blocked at
  apply time, including late-discovered cron rows, cache entries, runtime
  registries, generated assets, custom tables, and plugin-owned files; and
  otherwise a plugin can mutate state the planner never named;
- any partial file, DB, or plugin side effect has to be durably classified as
  old, new, or blocked before retry can rebuild scope from fresh live hashes,
  or a mixed-write can be relabeled as success after the fact.

Two comparison traps still need to be called out explicitly:

- Reprint source notes only support staged transport and resumable pull
  structure; they do not prove this branch's live push executor rejected a
  drifted remote before the first write, preserved the remote for audit, or
  kept a stale review artifact from becoming retry authority for a later
  boundary.
- ZS-Sync source notes only support bounded discovery and change scanning; they
  do not prove create-time identity remapping, plugin-owned allowlist coverage,
  or partial side-effect classification on a live mutation boundary.
- ForkPress source notes only support reviewed-resolution vocabulary and
  crash-consistency intent; they do not prove that a readable manual-review
  artifact stays audit-only after drift, that late plugin-owned surfaces are
  separately classified, or that the remote-preserving retry path is safe on
  this branch.
- Any comparison note that omits the exact upstream revision or worktree state
  remains historical context even when the feature family matches. If the note
  also omits the preserved remote, the stale rejection point, or the fresh
  retry scope on this branch, it cannot be promoted into current proof.
- A readable source-note comparison does not become retry authority for a
  later plugin-owned surface just because it names the right upstream family;
  if that later surface was discovered only after the first write, the branch
  must record a separate preserved remote, rejection point, and fresh retry
  scope for that new boundary.

Before this branch can claim production-grade push support, the design must
also prove all of the following on the live mutation boundary:

- a stale remote is rejected before any write and the preserved remote stays
  auditable after reject;
- the same stale artifact cannot become authority for a different row, file,
  relationship-bearing record, or plugin-owned surface on retry;
- a manual-review artifact, route-shaped smoke, or source-note comparison
  does not become retry authority unless the branch rechecked the same live
  boundary and recorded the preserved remote, rejection point, and fresh
  retry scope here;
- late-discovered plugin-owned state is classified explicitly, not folded into
  a successful manual-resolution story after the first write;
- partial DB/file/plugin side effects are recorded as old, new, or blocked so
  the next retry starts from fresh live evidence; and
- any source-note comparison stays provenance only unless this branch reruns
  the same live boundary against the same drift case and records the fresh
  retry scope.

The remaining production traps are still unproven in this branch:

- live remote drift can still be detected too late unless the apply boundary
  shows the preserved remote, the rejection point, and the unusable stale
  approval separately;
- conflict policy can still stay ambiguous when the remote drifts after a
  dry-run, because "manual resolution" can hide whether the remaining work is
  old, new, or blocked unless the retry scope is rebuilt from fresh live
  hashes and the preserved remote remains inspectable;
- false reliability claims can still leak in through lab-shaped language:
  a production-shaped route, package mount, fixture replay, readable review
  artifact, or `finalMatchesLocal` result is only compatibility evidence
  unless the branch re-ran the same live write boundary against a drifted
  remote and recorded the stale rejection before mutation;
- create-time identity remapping can still alias or renumber a target unless
  the branch proves the live remap path or hard-blocks it before write;
- plugin-owned state can still hide outside the allowlist through cron rows,
  cache entries, registries, generated assets, custom tables, or plugin-owned
  files unless those surfaces are enumerated or blocked at apply time; and
- partial file, DB, or plugin side effects can still leave a mixed-write
  state unless each touched store is durably classified old, new, or blocked
  and retry rebuilds scope from fresh live hashes.

Release gate for any production wording:

- Name the exact live mutation boundary, the exact stale-remote drift case,
  and the exact rejection point before mutation.
- Show the preserved remote stayed auditable after reject and that the stale
  approval or review artifact could not be reused as retry authority for a
  different row, file, relationship-bearing record, remapped create target,
  or plugin-owned surface.
- Show the live rerun on this branch, not just the upstream family name, and
  show that the retry scope was rebuilt from fresh live hashes on the same
  boundary after the reject.
- Show that any later write, including a plugin-owned surface discovered
  after the first write, was classified separately and not authorized by the
  earlier comparison note or manual-review artifact.
- Show create-time identity handling explicitly, either as a durable remap
  proof or a hard block before write.
- Show the full plugin-owned surface for the claim, including anything found
  late, and hard-block unknown or unvalidated surfaces.
- Show that a claim does not upgrade route shape, package mount, fixture
  replay, or a readable review artifact into production safety unless the
  branch-local live drift rerun and stale rejection are recorded here.
- Show that a route-shaped smoke or `finalMatchesLocal` match can still come
  from a copied executor behind the same URL family; if the branch did not
  rerun the same live mutation boundary and preserve the remote on this repo,
  that evidence stays compatibility-only and cannot support production
  wording.
- Show that a stale manual-review artifact from the first write cannot be
  reused as retry authority for a later-discovered plugin-owned surface,
  even if that later boundary is still behind the same route family or
  package mount shape.
- Show that a matching upstream revision or worktree state never becomes
  current retry authority by itself, even when it matches the feature family
  or route shape described in Reprint, ZS-Sync, or ForkPress source notes;
  without the same live boundary rerun here, the comparison stays historical
  context only.
- Show that any plugin-owned surface discovered only after the first write
  is classified as blocked, not retroactively folded into a success claim or
  treated as a safe continuation without fresh live evidence.
- Show that comparison notes remain provenance only unless this branch
  reverified the same live mutation boundary here; a matching upstream
  revision or worktree state must never become current retry authority by
  itself.
- Show that any source-note comparison names the exact upstream revision or
  worktree state being cited; otherwise it stays historical context even when
  the feature family matches.
- Show that the comparison also reran the same live mutation boundary on this
  repo; otherwise a matching upstream revision or worktree state remains
  provenance only.
- Show that a matching upstream revision or worktree state is still not
  enough by itself: the branch must also rerun the exact same live drift or
  retry case on this repo's live write boundary, or the comparison remains
  provenance only.
- Show that the exact upstream revision or worktree state does not become
  current proof unless the branch also names the late-discovered
  plugin-owned surface, the preserved remote, and the rejection point for
  that later boundary on this repo.
- Show that a readable manual-review artifact remains audit-only unless the
  preserved remote is inspectable, the stale artifact was rejected before
  mutation, and the fresh retry scope was rebuilt from live hashes on this
  branch; readability alone is not retry authority.
- Show that an inspectable manual-review artifact or source-note comparison
  still does not prove production safety when the route shape, package mount,
  or `finalMatchesLocal` output matches; unless this branch reran the same
  live drift case at the same mutation boundary, the artifact remains
  historical evidence only.
- Show that the comparison set is conservative: Reprint proves staged
  transport rhythm and resumable pull structure, ZS-Sync proves bounded
  discovery and cursoring, and ForkPress proves reviewed-resolution
  vocabulary plus a crash-consistency target. None of them proves this
  branch's live write path, preserved-remote retry, create-time remap
  handling, plugin-owned coverage, or partial-write classification without a
  same-boundary recheck here, and none of them may be treated as current
  proof unless the exact upstream revision or worktree state and the same
  live boundary are named on this branch.
- Show that a comparison note cannot be promoted to production-grade push
  support unless this branch reran the exact drifted remote on the live write
  boundary; a matching Reprint, ZS-Sync, or ForkPress note without that
  branch-local rerun is provenance only, even when the route shape, package
  mount, or `finalMatchesLocal` output looks correct.
- Show that the note stays historical even when the exact upstream revision
  is named, unless this branch also rechecked the same live boundary and
  recorded the preserved remote and rejection point here.
- Show that any readable manual-review artifact or source-note comparison is
  audit-only unless this branch reran the same live boundary and recorded the
  preserved remote, rejection point, and fresh retry scope on this branch.
- Show that late-discovered plugin-owned state does not widen the write scope
  silently through cached ownership, fallback behavior, or a second write that
  only appears harmless because the first write already committed.
- Show that a stale manual-review artifact remains audit-only after drift,
  cannot authorize a second write, and cannot be widened into a different
  row, file, relationship-bearing record, or plugin-owned surface without a
  fresh live retry scope.
- Show that a lab-shaped smoke, fixture replay, or package mount is not
  treated as production proof unless the live executor on this branch was
  rechecked at the same boundary and the stale rejection was observed here.

One more claim must stay explicitly out of production language until this
branch proves it: "manual resolution" is not reliable unless the remote is
preserved for audit, the stale rejection point is recorded, the retry scope is
rebuilt from fresh live hashes, and any later-discovered plugin-owned surface
is either blocked or separately classified before the next write. If any one of
those pieces is missing, the phrase describes a review artifact, not a safe
push path.
- Show that a stale manual-review artifact cannot become retry authority for
  a late-discovered plugin-owned surface just because the first write already
  succeeded on a narrower surface set; the proof must keep the preserved
  remote, blocked late surface, and fresh retry scope separate.
- Show that "manual resolution" cannot be recycled into a second write after
  a later plugin-owned surface appears, even if the first write looked clean;
  the branch needs a separate preserved remote, rejection point, and retry
  artifact for that later surface.
- Show that a source-note comparison cannot become retry authority for the
  live write path just because it names the right upstream commit or route
  family; if this branch did not rerun the same drifted remote and the same
  plugin-owned surface set, the note remains provenance only.
- Show that a late-discovered plugin-owned surface cannot be widened into a
  second successful write just because the first write already happened; the
  proof must separate the preserved remote, the blocked late surface, and the
  fresh retry scope for the remaining work.
- Show that conflict policy stays unambiguous when the late-discovered surface
  is blocked: the proof must record whether the remaining work is old, new, or
  blocked, and it must not relabel a blocked late surface as a successful
  manual resolution on the same write boundary.
- Show each touched store as old, new, or blocked, and show retry rebuilt
  scope from fresh live evidence instead of inheriting the old decision.
- Show the release claim is anchored in live-boundary evidence, not a copied
  lab route, packaged-plugin mount, fixture replay, or lab-shaped route
  family that only matches the production URL shape.
- Show that a matching upstream commit or worktree state is provenance only
  unless this branch also reran the same live mutation boundary and the same
  drift or retry case here; route shape, package shape, fixture replay, and
  `finalMatchesLocal` still cannot upgrade that comparison into current proof.
- Show that no historical source-note comparison is being upgraded into a
  current reliability claim without branch-local proof for the exact live
  boundary and failure case.
- Show that any Reprint, ZS-Sync, or ForkPress citation stays historical
  context unless this branch names the exact upstream revision or worktree
  state, rechecks the same live boundary here, and records the same drift,
  remap, or retry case against the current worktree; a matching note without
  that branch-local rerun is not production evidence.
- Show that branch-local revalidation exists for the exact same stale-remote,
  create-time remap, plugin-owned surface, or partial-write case being
  described; otherwise even a correct upstream note, matching route family,
  or readable review artifact stays historical context only.
- Show the claim does not collapse a lab-shaped success path into production
  safety just because the route name, response codes, or resource hashes look
  compatible; the missing proof is the live drift case on the real mutation
  boundary, not another fixture that happens to return the same shape.
- Show that any success wording is not based on a readable review artifact,
  route-shaped smoke, or copied fixture mount that only looked current; the
  claim must prove the live executor rejected stale authority before
  mutation and preserved the remote for audit.
- If Reprint, ZS-Sync, or ForkPress are cited, name the exact upstream
  revision or worktree state and say whether this branch reverified the same
  live boundary; otherwise the comparison is historical context only.
- Treat route shape, package shape, fixture replay, and `finalMatchesLocal`
  as compatibility evidence only. None of them prove production durability,
  production auth, or production write safety.
- Treat a source note, upstream commit id, or matching route family as design
  provenance only. Unless this branch rechecked the same live write boundary
  against the same stale-remote or retry case, it is not current proof.
- Even when an upstream note names the exact commit and the same feature
  vocabulary, that only proves provenance. If this branch did not rerun the
  same live drift, retry, or create-time identity case at the same mutation
  boundary, the comparison still cannot authorize production wording.

Must-fix blockers before any production wording:

- Live remote drift after dry-run must fail closed on the real write path,
  with the preserved remote auditable and the stale approval unusable for
  retry.
- Create-time identity remap, alias, or renumber cases must be proven safe or
  hard-blocked before mutation.
- Plugin-owned state outside the allowlist must be enumerated or blocked at
  apply time, including hidden side effects such as cron rows, cache entries,
  registries, generated assets, custom tables, and plugin-owned files.
- Partial file, DB, or plugin side effects must be durably classified old,
  new, or blocked, and retry must rebuild scope from fresh live hashes.
- A readable stale manual-review artifact must stay audit-only after drift
  and must not widen into another row, file, relationship-bearing record, or
  plugin-owned surface.
- A readable stale manual-review artifact must not become retry authority for
  a late-discovered plugin-owned surface even if the first write committed
  cleanly; the proof must keep the preserved remote, blocked late surface,
  and fresh retry scope separate.
- A readable stale manual-review artifact must not be treated as production
  safety just because it is inspectable, archived, or linked from the audit;
  if the same live boundary was not rerun here, the artifact is evidence of
  history, not current authority.
- A source-note comparison must not be treated as current retry authority
  just because the upstream commit, route family, or worktree state matches;
  without a branch-local live drift rerun on the same mutation boundary, it
  stays provenance and cannot rule out hidden plugin-owned side effects on the
  real executor.
- A readable stale manual-review artifact must not be described as durable
  retry authority, even when it remains inspectable; if a retry consumed it as
  authority, the proof failed to preserve a clean remote-audit separation.
- A readable stale manual-review artifact must not be allowed to justify a
  second write against a late-discovered plugin-owned surface; the proof has
  to show that the late surface was blocked or separately classified before
  any retry continued.
- A late-discovered plugin-owned surface must not be described as a harmless
  continuation of an earlier success if the proof does not show a separate
  rejection point, preserved remote, and fresh retry scope for that surface.
- A readable stale manual-review artifact must not be described as "manual
  resolution" success if the remote was already drifted or the late surface
  was still unclassified; that wording hides a mixed-write loss mode unless
  the remote was preserved, the late surface was blocked, and the retry scope
  was rebuilt from fresh live hashes.
- A matching upstream commit plus a green route-shaped smoke must not be
  described as current proof unless this branch re-ran the same live mutation
  boundary on the drifted remote and separately recorded the preserved remote,
  the stale rejection point, and the fresh retry scope; otherwise the pair is
  provenance only, even if `finalMatchesLocal` also passed.
- A late-discovered plugin-owned surface must not be described as a successful
  "manual resolution" when the remote was already drifted, because that hides
  a mixed-write failure mode; the proof must preserve the remote for audit,
  mark the late surface blocked or old/new explicitly, and record a fresh
  retry scope before any second write.
- A blocked late-discovered plugin-owned surface must not be relabeled as a
  successful manual resolution, a compatibility pass, or a harmless second
  phase unless the proof names the preserved remote, the blocked surface, and
  the fresh retry scope separately.
- A readable stale manual-review artifact must not be mistaken for branch-
  local revalidation. If the live write boundary, preserved remote, and fresh
  retry scope were not rechecked on this branch, the artifact stays
  inspection-only even when it is still readable.
- If a plugin-owned surface is discovered only after the first write, the
  claim must show the remote stayed preserved, the late discovery was blocked
  or durably classified, and the retry rebuilt scope from fresh live hashes;
  otherwise the late surface can still hide a partial-write loss mode.
- Reprint, ZS-Sync, and ForkPress comparisons stay historical unless the
  exact upstream revision or worktree state and the same live mutation
  boundary were reverified on this branch, with preserved-remote evidence
  and fresh retry scope captured here.
- A matching upstream commit or worktree state is only provenance, not
  current authority; if the branch did not recheck the same live mutation
  boundary here, the citation stays audit-only even when the route family or
  package shape looks identical.
- A route-shaped smoke or packaged-plugin mount is not a substitute for a
  branch-local live drift recheck. If the preserved remote, stale rejection
  point, and fresh retry scope were not observed here, the smoke only proves
  compatibility with the lab path.
- Route-shape smokes, packaged-plugin mounts, fixture replay, and
  `finalMatchesLocal` remain compatibility evidence only; they do not prove
  production durability, production auth, or production write safety.
- A copied upstream route shape or worktree state only proves that the lab
  route still resembles the source note. It does not prove the live executor
  on this branch rejected stale authority before mutation, preserved the
  remote for audit, or rebuilt the retry scope from fresh live hashes.

Source-note comparison summary:

What still needs proof before any production wording:

- a stale remote must fail closed on the live write path before the first
  mutation, and the preserved remote must remain inspectable after reject;
- a readable approval, comparison note, or manual-review artifact must not
  be reusable as retry authority for a different row, file, relationship-
  bearing record, or plugin-owned surface after drift;
- any late-discovered plugin-owned state must be either enumerated or hard-
  blocked before the next write, including cron rows, cache entries,
  registries, generated assets, custom tables, serialized blobs, and plugin-
  owned files;
- partial file, DB, or plugin side effects must be classified old, new, or
  blocked before retry, so mixed writes cannot be relabeled as success; and
- source-note comparisons must stay historical unless this branch names the
  exact upstream revision or worktree state and reruns the same live mutation
  boundary on this repo.

Failure scenarios that remain unproven:

- the remote drifts after dry-run, but the stale approval is still usable and
  the later write silently lands on the wrong state;
- the first write succeeds, then a later live snapshot reveals a new
  plugin-owned row, file, registry entry, or generated asset, and the earlier
  manual-review artifact is widened into authority for that second boundary;
- create-time identity remapping aliases or renumbers the target, so the write
  lands on a different identity than the one the planner reviewed;
- a plugin mutates state outside the allowlist, but the change is only
  discovered after apply and is folded into the success story instead of
  being blocked or separately classified; and
- a route-shaped smoke, package mount, fixture replay, or `finalMatchesLocal`
  match is mistaken for live proof even though it may only reflect a copied
  executor behind the same URL family.

- Reprint `27c5f25`
  - Proves: staged transport and resumable delivery rhythm in the upstream
    pull pipeline.
  - Does not prove: production auth, live-write safety, remote-preserving
    retry, stale-authority rejection on this branch, or hidden plugin-owned
    side effects outside the bounded pull pipeline.
  - Missing branch proof: a live source mutation boundary that rejects stale
    authority before write, preserves the remote for audit, and rebuilds retry
    scope from fresh live hashes after drift.
- ZS-Sync `d9334a0`
  - Proves: bounded discovery and scoped scanning.
  - Does not prove: create-time identity remap safety, remote-preserving
    retry, partial side-effect classification, late-discovered plugin-owned
    surface blocking, live alias/renumber handling, or source-side mutation.
  - Missing branch proof: explicit create-time identity reservation or hard
    block before mutation, plus durable old/new/blocked classification for
    partial side effects on the live write path.
- ForkPress `55f9879`
  - Proves: review/conflict vocabulary and a crash-consistency target.
  - Does not prove: that a readable stale manual-review artifact stays
    audit-only after drift, cannot become retry authority, or cannot widen
    into a different row, file, relationship-bearing record, or plugin-owned
    surface on the live push path.
  - Missing branch proof: a stale review artifact that remains auditable but
    cannot authorize retry or widen scope, including anything discovered after
    the first write.
- Combined limit: the three notes are transport provenance, discovery
  provenance, and conflict/audit provenance only. None of them proves the
  full production claim set on its own, and none of them upgrades route shape,
  package mount, or fixture replay into current proof without a branch-local
  live recheck at the same mutation boundary.
- Still missing here: live branch evidence for stale-drift rejection,
  create-time remap handling, plugin-owned surface coverage, partial
  side-effect classification, and a retry that rebuilt scope from fresh live
  hashes after the remote drifted.

Release-gate checklist for production-readiness wording:

- Name the exact live write path and the exact stale-remote drift case it
  survived; route shape, package layout, and `finalMatchesLocal` stay
  compatibility evidence only.
- Name the exact live mutation boundary and the exact late-discovered
  plugin-owned surface, if any, and show that the surface stayed blocked or
  separately classified before any retry reused preserved remote state.
- Name the exact source-note revision or worktree state being compared, and
  say whether this branch reverified that exact upstream state at the same
  live mutation boundary; otherwise the comparison is historical context
  only.
- Name the exact upstream revision or worktree state for any Reprint,
  ZS-Sync, or ForkPress comparison, plus the exact live write boundary that
  was reverified here and the exact branch-local drift or retry case that was
  exercised against it; otherwise the comparison is historical context only.
- Name the exact failure case that was rechecked on this branch as well; a
  matching upstream revision without the same branch-local drift or retry
  case is still historical context, not current proof.
- Show that the stale approval was rejected before mutation, remained
  readable for audit, and could not be reused as authority for any other
  row, file, relationship-bearing record, plugin-owned surface, or hidden
  side effect such as a cron row, cache entry, registry entry, generated
  asset, custom table write, or plugin-owned file that only surfaced after
  the first write.
- Show that any lab route, fixture replay, or packaged-plugin mount is only
  compatibility evidence unless the exact live mutation boundary on a drifted
  remote also failed closed before write and preserved the remote for audit.
- Show that the retry rebuilt scope from fresh live hashes after drift, and
  that the fresh retry artifact is recorded separately from the stale review
  artifact instead of inheriting the old decision or a stale manual-review
  artifact as current authority.
- Show that any readable stale manual-review artifact stayed audit-only after
  drift, could not authorize a retry, and could not be widened into a new
  row, file, relationship-bearing record, plugin-owned surface, or hidden
  side effect.
- Show that a late-discovered plugin-owned surface cannot be retrofitted into
  a clean manual-resolution story after the first write; the proof must keep
  the preserved remote, the blocked late surface, and the fresh retry scope
  separate.
- Show that any Reprint, ZS-Sync, or ForkPress comparison names the exact
  upstream revision or worktree state and the exact live write boundary that
  was reverified here; otherwise the comparison is historical context only,
  even if the route family, package shape, or feature vocabulary matches.
- Show that any readable review artifact, route-shaped smoke, fixture replay,
  or `finalMatchesLocal` result is labeled audit-only unless this branch
  reran the same live mutation boundary against the same drift case and
  recorded the preserved remote, rejection point, and fresh retry scope.
- Show that a stale manual-review artifact cannot be reused as retry
  authority for any plugin-owned surface or hidden side effect that was not
  already classified on the first pass.
- Show the create-time identity decision explicitly: either a durable remap
  proof or a hard block before write.
- Show the complete plugin-owned surface list for the claim, including any
  late-discovered custom table, generated file, cron row, cache entry,
  activation hook, runtime registry, serialized blob, or external side
  effect, and hard-block anything outside it.
- Show durable classification for partial file, DB, or plugin side effects,
  including what was written, what was blocked, what remains safe to retry,
  and what must not be widened on retry because the live remote drifted or
  because a hidden plugin-owned store still has unreconciled state.
- Show that a green hash, endpoint match, copied-lab mount, or route-shaped
  smoke is only compatibility evidence unless the same live mutation
  boundary also rejected stale authority before mutation on a drifted remote.
- If Reprint, ZS-Sync, or ForkPress are cited, name the exact upstream
  revision or worktree state and say whether it was reverified at the same
  live mutation boundary; otherwise the comparison is historical context
  only.
- Source notes are design input, not current proof. A matching upstream
  commit, mount shape, or route family still does not count unless this branch
  rechecked the same live write path and the same drift or retry case on the
  same boundary.
- For this branch, the source-note commits `27c5f25`, `d9334a0`, and
  `55f9879` remain historical input until a branch-local live-boundary
  recheck is recorded here.
- If a source note names the right upstream commit but this branch did not
  reverify that exact upstream state at the same live write boundary, the
  citation stays historical context only. A correct commit id without a fresh
  live-boundary recheck is still not current proof.
  If the branch-local drift or retry case differs from the upstream note's
  scenario, the citation stays historical context only.
- A comparison that only matches the upstream commit or worktree state still
  does not prove production push support unless this branch also reran the
  same live drift, stale-reject, and fresh-retry scenario on the current
  worktree. The missing proof is branch-local live evidence, not another
  comparison note.
- Matching route family, package shape, or mount shape still does not upgrade
  an upstream citation into current proof unless the live executor on this
  branch rejected stale authority before mutation and preserved the remote
  for audit.
- A correct upstream revision plus a route-shaped smoke still does not prove
  production readiness unless the branch also re-exercised the same stale
  remote, create-time identity, plugin-owned surface, or partial-write case
  on the live mutation boundary and recorded the preserved remote and fresh
  retry scope.

Source-note claim gate:

- Treat `docs/source-notes.md` as design input only. It can justify why the
  branch borrows staged transport, bounded scanning, or reviewed-resolution
  vocabulary, but it does not prove this repo's live executor, remote-drift
  rejection, create-time remap handling, or plugin-owned surface coverage.
- If a claim says a Reprint, ZS-Sync, or ForkPress note is current evidence,
  it must name the exact upstream commit or worktree state, the exact live
  write boundary, the exact drift or retry case that was reverified, and the
  branch-local same-boundary recheck. If any of those are missing, the note
  stays historical context only.
- A matching route shape, package mount, or `finalMatchesLocal` result never
  upgrades a source note into production proof. Those artifacts only show that
  a lab-shaped path still looks compatible with the source-note description.

Blocked production claims:

- "production-grade push" is blocked until the live mutation executor, not a
  lab route or copied fixture mount, has failed closed on a drifted remote and
  preserved the remote for audit.
- "safe manual resolution" is blocked unless the stale review artifact is
  audit-only after drift, cannot authorize retry, and cannot be widened to a
  different row, file, relationship-bearing record, plugin-owned surface, or
  hidden plugin side effect.
- "comparison passed" is blocked unless the exact upstream revision or
  worktree state and the exact live write boundary were both reverified in
  this repo; a matching route shape, package mount, or `finalMatchesLocal`
  result is compatibility evidence only.
- "plugin-safe push" is blocked until the full plugin-owned surface list is
  either enumerated live at apply time or hard-blocked, including late
  discoveries such as options, custom tables, generated files, hooks, cron
  rows, caches, runtime registries, serialized blobs, and external side
  effects.
- "plugin-owned surface covered" is blocked if the proof only checked a
  representative sample or a static allowlist; the claim must show either a
  live inventory of every owned surface on the exercised remote or a hard
  block for anything unknown, including surfaces discovered only after the
  first write.
- "safe create handling" is blocked until the create-time identity decision
  is explicit and durable, including rename, alias, or renumber cases on the
  live remote.
- "recoverable partial write" is blocked until every touched store is
  classified old, new, or blocked and the retry rebuilds scope from fresh
  live evidence instead of inheriting the old approval or widening a partial
  success into a broader claim.
- "manual resolution later" is blocked if the stale review artifact can still
  authorize retry for a plugin-owned surface or hidden side effect that was
  not already part of the audited scope.
- "current upstream proof" is blocked for any Reprint, ZS-Sync, or ForkPress
  comparison unless the exact cited upstream revision or worktree state was
  reverified at the same live mutation boundary and the comparison names the
  live write path, not just the feature family.

Production-grade push support still needs all of the following proofs on the
same live write path:

- Live remote drift after dry-run must fail closed on the real write path,
  with the preserved remote still auditable and the stale approval unusable
  for retry.
- Create-time identity remap, alias, or renumber cases must be proven safe or
  hard-blocked before mutation; a matching local ID does not prove the live
  target stayed stable.
- Plugin-owned state outside the allowlist must be enumerated or blocked at
  apply time, including late-discovered cron rows, cache entries, runtime
  registries, generated assets, custom tables, serialized blobs, and other
  hidden side effects.
- Partial file, DB, or plugin side effects must be durably classified old,
  new, or blocked, and retry must rebuild scope from fresh live hashes instead
  of inheriting stale approval.
- A readable stale manual-review artifact must stay audit-only after drift and
  must not widen into another row, file, relationship-bearing record, or
  plugin-owned surface.
- Any Reprint, ZS-Sync, or ForkPress comparison must name the exact upstream
  commit or worktree state and say whether this branch reverified the same
  live mutation boundary; otherwise the comparison is historical context only.
- Route shape, package mount shape, and `finalMatchesLocal` stay compatibility
  evidence only; they do not prove production durability, production auth, or
  production write safety.
- A copied-lab executor behind the same URL family is still compatibility
  evidence only; matching route names or package wiring does not prove the
  live mutation boundary, preserved remote, or retry authority on the real
  write path.

1. Live remote drift between dry-run and apply fails closed before the first
   mutation, and the preserved remote remains auditable after reject.
2. Create-time identity remapping, aliasing, or renumbering is either durably
   proven safe or hard-blocked before mutation, with no silent target swap.
3. Plugin-owned state outside the allowlist is enumerated or blocked at apply
   time, including late-discovered custom tables, generated files, cron rows,
   cache entries, runtime registries, serialized blobs, and external side
   effects.
4. Partial file, DB, or plugin side effects are durably classified as old,
   new, or blocked, and the next retry rebuilds scope from fresh live hashes
   rather than inherited approval.
5. A readable manual-review artifact stays audit-only after drift, cannot
   authorize retry, and cannot widen into a different row, file,
   relationship-bearing record, or plugin-owned surface.
6. A plugin-owned surface that appears only after the first write is either
   blocked or durably classified without widening the claim, and the retry
   scope is rebuilt from fresh live hashes.
7. Any Reprint, ZS-Sync, or ForkPress comparison names the exact upstream
   revision or worktree state and the exact live mutation boundary that was
   reverified here; otherwise it is historical context only.
8. Route shape, package shape, fixture replay, and `finalMatchesLocal` stay
   compatibility evidence only and never become production-safety proof.

The protocol has useful lab properties: dry-run/apply separation, live-remote
revalidation, idempotency keys, a recovery vocabulary, and hash-only evidence
for several lab slices. None of that is production proof. The missing proofs
are not cosmetic. They are the exact points where a partial write, hidden
plugin side effect, stale retry, or graph rewrite can silently lose remote
state while the system reports a plausible success. A route-shaped smoke,
copied-lab mount, or fixture-backed hash never upgrades to production proof
unless it exercised the live mutation executor against a drifted remote and
rejected stale authority before mutation.
In particular, a green lab result never counts as production proof unless the
same live write path was exercised against a drifted remote and the audit shows
the stale approval was rejected before mutation.
The same rule applies to Reprint, ZS-Sync, and ForkPress comparisons: they
can justify the design direction, but they do not become current proof unless
this branch reverified the cited upstream state at the exact live write
boundary being claimed. A stale manual-review artifact may remain readable for
audit, but it is not current authority after remote drift and must not be
treated as retry permission.

The next production-proof gap is not general reliability jargon. It is five
specific missing proofs:

- live remote drift must be rejected on the exact write path, with the stale
  hash set, rejected approval, and preserved remote all auditable;
- a readable stale manual-review artifact must remain audit-visible but be
  unusable as a retry token after drift;
- create-time identity remapping must either be proven safe or fail closed
  before mutation, so a create cannot silently alias a different target or
  reuse the wrong live identity after a rename, alias, or renumbering event;
- plugin-owned state outside the allowlist must be discovered or blocked at
  apply time, not inherited from stale local metadata, a fixture-only map, or
  a single representative option/custom-table/file sample;
- partial file, DB, or plugin side effects must be durably classified so a
  retry cannot widen the old approval or turn recovery evidence into current
  authority; and
- a fixture-backed or copied-lab route cannot be treated as production proof
  just because it returns current-looking hashes, names the right endpoint, or
  matches `finalMatchesLocal`.

The failure scenarios that still need explicit proof are:

- A dry-run approval goes stale because the live remote changed before apply;
  the missing proof is the exact rejection point on the live mutation boundary
  and an audit trail showing the preserved remote was still inspectable after
  the reject.
- A create request maps to a different live identity than the local plan
  expected; the missing proof is either a safe remap with preserved identity
  audit, a separately recorded retry artifact, or a hard block before
  mutation.
- A plugin owns data outside the allowlist, such as options, custom tables,
  generated files, activation hooks, cron rows, cache entries, runtime
  registries, or serialized blobs hidden behind a single row; the missing
  proof is explicit discovery or hard failure at apply time, not inference
  from a single representative record.

Claims that must still be rejected as false reliability:

- "The route passed, so push is production-safe" when the only evidence is a
  lab route, packaged mount, fixture replay, or `finalMatchesLocal`; the
  missing proof is the live mutation boundary rejecting stale authority on a
  drifted remote before mutation, with the preserved remote still auditable
  after the reject.
- "The packaged plugin mounted the right endpoint, so production is ready"
  when the package only reproduces the lab URL family; the missing proof is a
  live write-path reject on a drifted remote plus an auditable preserved
  remote and fresh retry scope on the same branch.
- "The review artifact was readable, so retry was safe" when the artifact is
  stale manual-review output; the missing proof is that the artifact stayed
  audit-only, could not authorize retry, and could not widen into another
  row, file, relationship-bearing record, or plugin-owned surface.
- "The late plugin surface was handled" when the proof only shows the first
  write succeeded and a later surface was noticed afterward. The missing
  proof is that the preserved remote stayed auditable, the late surface was
  hard-blocked or durably classified before any retry, and the retry scope was
  rebuilt from fresh live hashes rather than inheriting the stale review
  artifact.
- "The plugin surface was covered" when only one row or one plugin sample was
  checked; the missing proof is a complete live inventory of plugin-owned
  surfaces or a hard block for unknown surfaces, including late-discovered
  options, cron rows, cache entries, custom tables, generated files, runtime
  registries, serialized blobs, hooks, and external side effects.
- "The smoke looked current, so the live executor must be current" when the
  only evidence is a copied fixture or route-shaped mount; the missing proof
  is the exact live boundary, stale rejection point, preserved remote, and
  retry artifact on this branch.
- "The comparison passed" when Reprint, ZS-Sync, or ForkPress are cited by
  commit alone; the missing proof is a branch-local recheck of the same live
  mutation boundary and the same drift or retry case, not just provenance for
  a matching route family or mount shape.
- "The source note matched, so hidden side effects are covered" when the
  only evidence is an upstream commit, route family, or fixture-shaped replay;
  the missing proof is a branch-local live rerun that enumerated or blocked
  the full plugin-owned surface set on the real executor, including late
  discovered options, cron rows, caches, custom tables, generated files, and
  runtime registries.
- "The upstream note looks current, so the branch is current" when the note
  only proves design provenance; the missing proof is a fresh branch-local
  recheck of the same live write path, the same stale-remote case, and the
  same rejection point before mutation.
- A partial apply writes one store but not another, or writes plugin-owned
  state that the core row audit does not mention; the missing proof is durable
  old/new/blocked classification for each touched store, plus a retry rebuilt
  from fresh live evidence instead of reusing the old authority token.
- A manual-review artifact stays readable after drift; the missing proof is
  that it becomes audit-only, cannot authorize retry, and forces the next
  attempt to rebuild scope from fresh live evidence after the remote was
  preserved for audit, with a fresh retry artifact recorded instead of
  widening to a different row or file, or targeting a relationship-bearing or
  plugin-owned surface, including any late-discovered option, table, file,
  cron row, cache, runtime registry, or generated artifact.
- A live remote drift is detected only after the first write has already
  started; the missing proof is a fail-closed pre-write boundary, not a
  post-hoc "partial recovery" story that rebrands a mixed write as success.

Release-gate addendum for the next production claim:

- Any Reprint, ZS-Sync, or ForkPress citation must name the exact upstream
  commit or worktree state, the exact live write boundary, and the exact drift
  or retry case rechecked on this branch; otherwise it is historical only.
- Any comparison that only matches the source-note vocabulary, upstream
  revision, or route shape remains historical context until the audit shows
  the live mutation executor, preserved remote, stale rejection point, and
  fresh retry scope on this branch.
- Any comparison that points to a readable stale manual-review artifact
  without showing the branch-local reject point and fresh retry artifact
  remains historical context. Readability is not retry authority.
- Any manual-resolution claim must show the preserved remote, the rejection
  point before mutation, and that the old artifact stayed audit-only: it
  cannot authorize a retry against a different row, file, relationship-
  bearing record, or plugin-owned surface, and the next attempt must produce
  a fresh retry artifact.
- Any retry claim must show a newly recorded retry artifact tied to the
  preserved remote, not a reused review note or stale approval, and must
  prove that the retry rebuilt scope from fresh live evidence after drift.
- Any create-time identity claim must show either a durable remap proof or a
  hard block before write on the live remote; a fixture mount, route shape, or
  `finalMatchesLocal` result is not enough.
- Any plugin-owned data claim must enumerate or block the full owned surface at
  apply time, including late-discovered options, custom tables, generated
  files, cron rows, caches, runtime registries, serialized blobs, activation
  hooks, and external side effects; a sample-based allowlist review is not
  enough to claim production safety.
- Any partial-write claim must classify each touched store as old, new, or
  blocked and must show that retry rebuilt scope from fresh live evidence
  instead of inheriting the partial result as authority.

Source-note comparison boundary:

- Reprint at `27c5f25` proves a staged transport rhythm and resumable
  delivery shape in the upstream pull pipeline; it does not prove that this
  repo has a live remote write boundary that rejects stale authority before
  mutation, preserves the remote for audit, or rebuilds retry scope from fresh
  live hashes after drift.
- ZS-Sync at `d9334a0` proves bounded discovery and scoped scanning in the
  upstream scanner/resource layer; it does not prove create-time identity
  reservation, remote-preserving retry, plugin-owned write safety at apply
  time, or durable old/new/blocked classification for partial side effects.
- ForkPress at `55f9879` proves review and conflict vocabulary plus a
  reliability target for crash consistency; it does not prove that a stale
  review artifact cannot be reused as write authority after the remote drifts,
  that remote-preserving retry is implemented here, or that the remote is
  preserved for audit after reject.
- None of those notes prove that a readable stale manual-review artifact is
  unusable as retry authority unless the remote stayed preserved and the next
  attempt rebuilt scope from fresh live evidence at the same live write
  boundary.
- Even a correct upstream commit or worktree state is only provenance until
  this branch replays the same live drift or retry case at the same boundary;
  matching feature names, route families, or mount shapes do not upgrade the
  note into current proof.
- Therefore, any production wording that cites a source note must still show
  the missing repo proof on this branch: the exact live write boundary, the
  preserved remote snapshot, the stale rejection point, the fresh retry
  scope, and the failure case that was actually exercised. Without all five,
  the note remains historical input only.

Any comparison that omits the exact upstream revision or worktree state being
reverified remains historical context only, even if it names the same feature
or route family.

One more claim needs to stay blocked even when the route, mount, or hash looks
healthy: a stale manual-review artifact is not a success path just because it
remains readable. If that artifact can still authorize a retry against a new
row, file, relationship-bearing record, or plugin-owned surface, the design
has not shown remote preservation or fresh-scope revalidation. "Manual
resolution later" only becomes acceptable after the remote-preserving audit
trail, the stale-artifact rejection point, and the fresh retry scope are all
observable on the same live write boundary.
- Readability also does not prove branch-local revalidation. If the audit does
  not separately name the live boundary recheck on this branch, the artifact
  remains provenance, not current proof.

The missing evidence for each one is concrete:

- For live drift, the audit needs the actual stale hash set and the exact
  rejection point on the live write boundary, not just a route-shaped smoke
  or a matching endpoint name.
- For stale review artifacts, the audit needs proof that the artifact stays
  readable for inspection but cannot authorize a retry, widen to a different
  row or file, or be reused against a plugin-owned surface.
- For comparison language, the audit needs the exact upstream revision or
  worktree state to be named and reverified at the live write boundary; a
  stale note that only sounds current is historical context, not production
  proof, and it cannot be used to imply the live executor on this branch was
  exercised.
- For create-time identity remapping, the audit needs either a safe remap
  proof or a hard block before mutation when the live remote can rename,
  alias, or reassign the target.
- For plugin-owned state, the audit needs explicit coverage or a hard block
  for options, custom tables, generated files, activation hooks, cron rows,
  cache entries, and runtime registries that are not in the allowlist.
- For partial side effects, the audit needs old/new/blocked classification for
  every touched store, plus a retry that starts from fresh live evidence
  instead of inheriting the old approval.

Changes that must happen before any production-grade push claim:

- Tie the claim to a real live write-path proof on the exact request path,
  with the stale remote hash set, the rejected approval, and the retry scope
  all named explicitly; route shape, packaged-plugin mounting, and
  `finalMatchesLocal` are only compatibility evidence.
- Show that a readable stale manual-review artifact stayed audit-only after
  drift, could not widen to a different row, file, relationship-bearing
  record, or plugin-owned surface, and was replaced by a separately recorded
  fresh retry artifact built from current live hashes.
- Prove stale authority fails closed after live drift, while the rejected
  approval remains auditable but unusable for apply and cannot be widened to a
  different row, file, relationship-bearing record, or plugin-owned surface.
- Prove create-time identity remapping is either safe and replayable or
  hard-blocked before write, with the identity reservation or failure case
  named for the live remote.
- Prove plugin-owned state outside the allowlist is either fully enumerated or
  hard-blocked, including ownership revalidation at apply time and a failure
  path for late discovery of options, custom tables, generated files, hooks,
  cron rows, caches, registries, or serialized blobs.
- Prove partial file, DB, or plugin side effects are durably classified and do
  not let a retry widen the old approval, inherit stale scope, or treat a
  partially committed store as a fully successful push.
- Keep any Reprint, ZS-Sync, or ForkPress comparison explicitly historical
  unless the cited upstream commit or worktree state was reverified against
  the same live boundary on this branch; route shape, fixture replay, and
  `finalMatchesLocal` cannot promote a comparison into current proof.
- Reverify any Reprint, ZS-Sync, or ForkPress comparison against the exact
  upstream commit or worktree state being cited, the exact live mutation
  boundary being claimed, and the branch-local same-boundary recheck, or
  label it historical only.
- Reverify the cited Reprint `27c5f25`, ZS-Sync `d9334a0`, and ForkPress
  `55f9879` notes against the live boundary or stop treating them as current
  evidence.
- Do not collapse "correct upstream citation" into "current evidence"; the
  claim must also show a fresh branch-local recheck at the same live boundary.
- Treat `docs/source-notes.md` as historical input unless the branch can name
  the exact upstream commit or worktree state and the live write boundary that
  was reverified; a local note file does not upgrade itself into production
  proof.

Current anti-claims:

- A route-shaped smoke does not prove production push support, even if the
  endpoint name, mount path, or hash output matches the expected lab shape.
- A copied-lab mount does not prove the live executor ran, so it cannot
  justify claims about remote preservation, stale-authority rejection, or
  retry safety.
- A source note that matches the vocabulary of the current branch does not
  prove this branch's live boundary; it still needs the explicit local
  recheck, preserved remote, and stale rejection point.
- A readable manual-review artifact is not current authority after drift.
  It only counts if the audit shows the preserved remote, the rejection point,
  and the fresh retry scope on the same live write boundary.
- "Manual resolution later" is not a success claim unless the remote was
  preserved for audit, the stale artifact was rejected before mutation, and
  the retry rebuilt scope from fresh live evidence without widening to a new
  row, file, relationship-bearing record, or plugin-owned surface.
- A matching upstream feature family is not current proof. Reprint,
  ZS-Sync, and ForkPress stay historical context until the exact upstream
  revision or worktree state is named and reverified at the same live
  mutation boundary in this branch.

Production-grade wording requires the claim to name all of the following, or
it stays non-production regardless of route shape, package mount, or
`finalMatchesLocal`:

- the exact live write boundary that was exercised;
- the exact stale remote hash set that caused rejection;
- the exact preserved remote snapshot that remained auditable after rejection;
- the exact retry scope rebuilt from fresh live evidence;
- the exact create-time identity decision, including reservation, remap, or
  hard block, and whether the live remote could rename, alias, or renumber the
  target;
- the exact plugin-owned surfaces in scope, or an explicit hard block for
  unknown surfaces, including late-discovered options, custom tables, generated
  files, hooks, cron rows, caches, registries, and serialized blobs;
- the exact partial side-effect classification for file, DB, or plugin writes,
  with old/new/blocked state named per touched store;
- the exact reviewer artifact that became audit-only after drift; and
- whether any Reprint, ZS-Sync, or ForkPress comparison was reverified
  against the cited upstream revision or worktree state.

Release-grade checklist:

- The exercised path was the live mutation executor, not a lab route shape,
  fixture replay, or copied package mount that only looked production-shaped.
- The proof showed live remote drift between dry-run and apply, and the write
  failed closed before any mutation on the exact live path.
- The proof preserved the remote for audit and recorded the stale hash set,
  rejected approval, and fresh retry scope on the same live boundary.
- The stale manual-review artifact stayed readable for inspection but could
  not authorize a retry, widen to a different row/file/relationship-bearing
  record/plugin-owned surface, or substitute for fresh live hashes after
  drift.
- The retry rebuilt scope from fresh live evidence instead of reusing the old
  approval against a different row, file, relationship-bearing record, or
  plugin-owned surface.
- Any Reprint, ZS-Sync, or ForkPress comparison named the exact upstream
  revision or worktree state and said whether that state was reverified at
  the same live mutation boundary; otherwise the comparison stayed historical
  context only.
- If the live remote drifted, the stale approval was rejected before any
  mutation and the preserved remote remained auditable for retry review.
- The stale approval stayed auditable but could not authorize a retry, a
  different row, a different file, a relationship-bearing record, or a
  plugin-owned surface, including a late-discovered one.
- A lab route, package mount, or fixture replay was never used as a shortcut
  for production wording, even if it matched the expected endpoint family or
  produced `finalMatchesLocal`.
- A readable manual-review artifact was demoted to audit-only and could not be
  reused as current write authority after drift.
- Manual resolution stayed audit-visible but could not be reused as current
  write authority after drift, and the preserved remote remained inspectable
  for retry review.
- Create-time identity remapping was either proven safe at the live boundary
  or blocked before any write.
- If create-time identity could rename, alias, or renumber the target, the
  proof named the reservation or remap decision on the live remote rather than
  assuming local IDs remained stable.
- Every plugin-owned surface in scope was explicitly enumerated or hard-
  blocked, including options, custom tables, generated files, activation
  hooks, cron, caches, runtime registries, and serialized blobs.
- Any plugin-owned surface discovered late at apply time caused a hard failure
  rather than being inherited from stale metadata, a fixture-only map, or a
  previously approved retry scope.
- Partial file, DB, or plugin side effects were durably classified, and the
  retry rebuilt scope from fresh live evidence instead of inheriting the old
  approval.
- If one store committed and another did not, the proof labeled the result
  partial rather than claiming recovery success, and it preserved the old/new/
  blocked distinction for each store.
- Any Reprint, ZS-Sync, or ForkPress comparison names the exact upstream
  revision or worktree state that was reverified; otherwise it is historical
  context only.
- If a comparison note was not rechecked at the same live mutation boundary,
  it stayed historical even if the endpoint, package mount, or hash looked
  current.
- If the note is only a source-note summary and not a branch-local live
  boundary recheck, it cannot support a production claim, no matter how
  closely the route or package shape matches.

Release-go/no-go scenarios:

- If a live remote changes after dry-run and before apply, the stale approval
  must be rejected before the first mutation and the preserved remote must
  stay inspectable for audit. If the write already happened, the proof is a
  failure, not a recovery.
- If create-time identity remaps, aliases, or renumbering are possible, the
  design must show either a safe remap at the live boundary or a hard block
  before mutation. A fixture that keeps the same ID is not proof that the live
  remote cannot reassign identity.
- If plugin-owned state exists outside the explicit allowlist, apply-time
  revalidation must either enumerate it or block it. A matching option row,
  generated file, or custom-table sample does not prove the rest of the
  plugin-owned graph is safe, and any late-discovered store becomes a data
  trap unless the proof blocks it at apply time.
- If one store commits and another does not, the failure must be classified
  durably as partial side effects with fresh retry scope. Manual resolution
  only counts when the remote is preserved, the stale artifact is rejected as
  authority, and the retry starts from new live evidence.
- If drift is only detected after the first write starts, the proof must show
  the earlier write is durably fenced and auditably incomplete; it cannot be
  used as evidence of a successful production retry.
- If a stale manual-review artifact remains readable after drift, that
  readability is audit evidence only. It is not retry authority unless the
  proof shows the artifact cannot widen to a different row, file,
  relationship-bearing record, or plugin-owned surface.
- If a comparison note cites Reprint, ZS-Sync, or ForkPress, it must name the
  exact upstream revision or worktree state and the exact live write boundary
  that was reverified. Otherwise it is historical context, not current proof.

Release wording must stay blocked if the only support is a route-shaped lab
fixture, copied package mount, or hash match:

- A lab-shaped `/wp-json/reprint/v1/push/*` route does not prove the live
  executor ran, and it does not prove the remote was preserved for audit
  after a stale reject.
- A readable manual-review artifact does not become current authority just
  because it is inspectable; the proof must show the stale artifact was
  rejected before mutation, stayed audit-only, and could not be reused
  against a different row, file, relationship-bearing record, plugin-owned
  surface, or hidden side effect.
- A plugin-owned fixture row or option does not prove the broader
  plugin-owned graph is safe if custom tables, generated files, cron rows,
  caches, runtime registries, serialized blobs, activation hooks, or other
  late-discovered surfaces were not enumerated live and either revalidated or
  hard-blocked.
- A comparison to Reprint, ZS-Sync, or ForkPress is still historical context
  unless the exact upstream revision or worktree state, the exact live write
  boundary, and the exact branch-local drift or retry case are all named and
  reverified here.

- A fixture that reproduces the path shape, package layout, or endpoint name
  does not prove the live mutation executor was exercised.
- A copied-lab mount that returns the expected hash does not prove the remote
  was drifted, rejected, preserved, and re-audited on the same boundary.
- A note that sounds current but was not reverified at the exact live write
  boundary must be treated as historical context even if it mentions the right
  route family or package mount.

Comparison rule: a source note can support design context, but it cannot
support current production wording unless the branch rechecked the same
upstream state at the same live write boundary. If that recheck did not
happen, the note stays historical even when the route shape, package mount, or
hash looks current.

The same restriction applies to any `production-shaped` label in progress
pages, smoke names, or audit summaries. That wording can describe a lab route
profile, a packaged plugin mount, or a route-compatibility check, but it is
not proof of a production-backed mutation boundary unless the live remote
drifted and the apply path failed closed before mutation. If the surrounding
text does not name the rejected stale hash set, the preserved remote, and the
fresh retry scope, the label is still compatibility language.

In the same way, a route-shaped smoke or package-mounted fixture can at most prove compatibility with the route contract; it does not prove the write executor preserved the remote, rejected stale authority, or classified partial side effects correctly. The missing proof is the live mutation boundary itself, not the endpoint shape.
The release gate and the long audit should stay aligned on one point: a matching endpoint name, ingress shape, or packaged-plugin mount is compatibility evidence only unless the exact live mutation boundary was exercised against a drifted remote and stale authority failed closed before mutation.
This means a source-note comparison cannot be promoted into live write-path safety unless the claim also names the exact boundary that was exercised and the exact upstream revision or worktree state that was reverified.
False reliability claims are any wording that turns route shape, copied mounts, `finalMatchesLocal`, or source-note similarity into production safety without naming the drifted remote, the stale rejection point, the preserved remote, and the fresh retry scope on the same live boundary.

Release-claim rule: if a claim does not name the live write boundary, the stale rejection, the preserved remote, the fresh retry scope, and whether the Reprint, ZS-Sync, or ForkPress comparison was reverified at the exact upstream revision/worktree state, it is not production wording. Route-shape smokes, packaged-plugin mounts, fixture replays, and `finalMatchesLocal` remain compatibility evidence only, even when they look current. A matching endpoint name or hash does not prove the production executor ran, the remote stayed preserved, or stale authority failed closed before mutation. A comparison note that was not reverified at the same live mutation boundary stays historical context even if the cited upstream revision is named correctly. A production claim must not blur those categories by implying that a lab-shaped route, a copied-lab mount, or a matching hash is the same thing as a live mutation proof.

Claim rule: if a doc, PR description, review comment, or status note cites Reprint, ZS-Sync, or ForkPress, it must say whether the cited upstream behavior was reverified against the current commit or worktree state. If it was not reverified, the citation stays historical context only. If it cites a route-shape smoke, packaged-plugin mount, or `finalMatchesLocal`, it must also name the live write boundary that was exercised, the remote-drift case that failed closed, and the stale artifact that became audit-only.
If a claim reuses those source notes without naming the exact upstream revision or worktree state that was checked, the claim is overbroad. "Same idea as upstream" is comparison language, not current proof, and it does not satisfy the release gate by itself.
If the branch has not reverified the exact upstream commit or worktree state named in the comparison, the note is historical context only, even when the endpoint path, plugin package, or response hash looks production-shaped.
The source-note comparison has one more hard limit: Reprint's resumable transport proves a staged delivery shape, not a safe source overwrite boundary; ZS-Sync's scanners prove bounded discovery, not a conflict policy for writes; and ForkPress's reviewed merge language proves the right reliability vocabulary, not that this repository has the same live-remote executor or crash-safe mutation boundary. Reprint does not prove live remote drift rejection at the write boundary, ZS-Sync does not prove create-time identity reservation or remote-preserving retry, and ForkPress does not prove that this repo's push path preserves the remote after a partial apply. None of those notes prove that plugin-owned state outside the allowlist is blocked, that a create can reserve stable identity on the live remote, or that a partial file/DB/plugin write leaves an audit trail instead of a false success. The missing proof is always repo-local and executable: a live remote snapshot must disagree, the apply must fail closed before any write, and the audit trail must show the preserved remote plus the rejected scope. A note that is not re-verified against the current upstream commit or worktree state is historical context only; it cannot be upgraded into current proof by matching route shape, package shape, or `finalMatchesLocal`.
Progress pages and status comments have the same bar. Phrases like "production readiness trend," "production gates proven," or "safe to ship" are false-reliability claims unless they name the exercised live write boundary, the rejected stale authority, the preserved remote, the fresh retry scope, and whether the cited upstream note was reverified at the exact same boundary. A lab smoke summary or packaged-route status line cannot imply production safety by itself.
If a note cites a Reprint, ZS-Sync, or ForkPress revision that was not rechecked at the exact live mutation boundary being claimed, the comparison remains historical context even when the endpoint, package, or hash looks production-shaped.
Matching ingress, route name, or package layout is not enough to turn a lab-shaped route into production proof. If the proof does not identify the exact live mutation boundary and the exact rejection point for stale authority, it is still compatibility evidence only.
Those upstream notes are snapshots, not current upstream proof. They anchor comparison text, but they do not prove the upstream repos still behave that way today or that this branch has matched them at the mutation boundary.
No source note proves that a stale manual-review artifact can survive a live
drift and still authorize apply, so any retry claim has to be backed by a
fresh snapshot, a fresh plan, and a rejected old artifact that remains
auditable rather than reusable.
The same rule applies to "production-shaped" wording: a route, plugin mount,
or response hash may look production-like, but without a live drifted remote
and a failed-closed apply boundary it is still only compatibility evidence.
None of the three source notes prove remote-drift rejection at apply time,
stable identity reservation for creates, or revalidation of plugin-owned
ownership changes immediately before write.
None of the source notes prove that stale manual-review artifacts are rejected
before write, that retries after live remote drift start from a fresh
snapshot, or that a fixture replay remains safe when identity or plugin-owned
state changes on the live remote.
What the notes do prove is narrower: Reprint gives the transport rhythm we can
borrow, ZS-Sync shows that bounded scanning is feasible, and ForkPress shows
that reviewed resolution and crash classification are the right failure
language. Those are source-note lessons from other repos, not proof that this
repo has the same mutation guarantees. None of them prove that this repository
has matched those semantics at the mutation boundary, and none of them prove
that a positive lab result survives a fresh live snapshot, a drifted remote,
or a narrowed retry scope. If the branch has not rechecked the exact cited
upstream revision or worktree state against the same live write boundary, the
comparison is historical context only, even when the route, package mount, or
hash looks current.

The project must treat the following as false-reliability claims and keep
them out of production wording until the live write path is proven:

- "The route is production-safe" when the only evidence is route shape,
  packaged-plugin mounting, or `finalMatchesLocal`.
- "The route is production-safe because the source notes mention the same
  feature" when the notes were not re-verified against the current upstream
  commit or worktree and the branch has not reproduced the live mutation
  boundary.
- "Manual resolution is enough" when the stale artifact can be reused after a
  drift, widened to a different surface, or applied without a fresh live
  snapshot.
- "The comparison notes prove the behavior" when the cited Reprint,
  ZS-Sync, or ForkPress evidence has not been re-verified against the current
  upstream commit or worktree state.
- "The plugin is handled" when the proof only covers the main row and not
  plugin-owned options, custom tables, generated files, activation hooks,
  cron, or cache side effects.
- "Recovery succeeded" when the system only classified the failure and did
  not prove that the remote was preserved, the write failed closed, or the
  retry rebuilt scope from fresh evidence.

False-reliability claims that also need to stay out of production wording:

- "Manual resolution succeeded" is false unless the preserved remote, the
  rejected stale approval, and the fresh retry scope are all named on the same
  live boundary; readable audit artifacts alone do not prove retry authority.
- "The plugin is handled" is false unless the proof covers every declared
  plugin-owned surface in scope or hard-blocks unknown surfaces, including
  custom tables, generated files, roles/caps, activation hooks, cron rows,
  caches, runtime registries, and external side effects.
- "The comparison proves it" is false unless the cited Reprint, ZS-Sync, or
  ForkPress note was reverified at the same live mutation boundary and against
  the exact upstream revision or worktree state named in the claim.
- "ForkPress-style review safety" is false unless the proof shows this branch's
  live mutation executor preserved the remote, rejected stale authority before
  mutation, and kept the stale review artifact audit-only after drift.
- "The comparison is current" is false unless the branch rechecked the exact
  cited upstream revision or worktree state against the same live write
  boundary; otherwise the note is historical context only.
- "Recovery succeeded" is false whenever one store committed and the rest were
  merely classified; mixed file, DB, or plugin writes still need old/new/
  blocked evidence and a retry rebuilt from fresh live hashes.
- "The route is production-safe" is false when the only proof is route shape,
  a packaged-plugin mount, or `finalMatchesLocal`, because those only show
  compatibility with the contract, not the live write boundary.

Additional hard blocker for this lane: any proof that comes from a
fixture-backed or copied-lab write path behind a production-shaped mount is
compatibility evidence only, even if it returns live-looking hashes. That
scenario still has to name the live mutation boundary, the stale rejection,
and the preserved remote before it can support production wording.

Release-grade wording has a hard checklist too. If any item is missing, the
claim must stay lab-backed or comparison-only. A route-shaped smoke, packaged
mount, or `finalMatchesLocal` match never upgrades to production proof unless
it exercised the exact live mutation boundary against a drifted remote:

- Name the exact live write boundary that was exercised, not just the route
  shape or package mount.
- Name the stale remote hash set that caused the rejection, and show the
  rejected approval stayed auditable but unusable.
- Name the retry scope and show it was rebuilt from fresh live hashes rather
  than inherited from the old approval.
- Name the create-time identity decision, including whether the remote
  reserved the identity, remapped it, or hard-blocked the write.
- Name every plugin-owned surface in scope, including options, custom tables,
  generated files, activation hooks, cron rows, cache entries, and runtime
  registries.
- Show that unknown plugin-owned state failed closed before mutation instead
  of becoming writable through fallback behavior.
- Show that partial file, DB, or plugin side effects are durably classified and
  cannot widen the old approval to a different row, file, relationship, or
  plugin-owned surface on retry.
- Show that stale manual-review artifacts stay readable for audit but cannot
  authorize a different row, file, relationship-bearing record, or plugin-
  owned surface after drift.
- If Reprint, ZS-Sync, or ForkPress are cited, name the exact upstream
  revision or worktree state that was reverified at the same live mutation
  boundary. Otherwise the comparison is historical context only.

The current design also still has five unproven failure classes that matter for
production push safety: live remote drift between dry-run and apply, create-time
identity remapping, plugin-owned state outside the allowlist, partial file/DB/
plugin side effects, and stale manual review artifacts. For each one, the
missing proof is concrete: either the write is rejected before mutation, or the
remote-preserving retry path is fully auditable and replay-safe. A plugin data
trap is not solved by naming the table or file class alone; the proof has to
show that plugin-owned options, custom tables, generated files, activation
hooks, and cache side effects are either explicitly contracted or hard-blocked.
Likewise, a create path is not safe because it can name an object class; it has
to prove stable identity reservation or fail closed when the remote can
renumber, alias, or reassign the target. Until each class has that proof or a
hard block, a success message is stronger than the evidence.
That applies equally to review artifacts: a stale approval that can still be
reused after drift is not a review trail, it is an unsafe capability leak. The
audit must show the stale artifact remains readable for inspection, is rejected
before write, and cannot be widened to a different row, file, or plugin-owned
surface on retry.
The strongest false-positive pattern to avoid is a lab route that returns the
right endpoint shape and a live-looking hash while still using fixture-backed or
copied-lab internals; that only proves the wrapper answered, not that the live
mutation boundary was exercised or that remote drift was checked before write.
The same trap applies to comparison language: a cited Reprint, ZS-Sync, or
ForkPress note can be useful context, but it is still not current proof unless
the exact upstream revision or worktree state was reverified at the same live
mutation boundary.
The same warning applies to plugin data traps that are easy to miss in review:
plugin-owned options, custom tables, generated files, activation hooks, cron,
and cache entries can all mutate outside the main post/page row plan. If any
plugin-owned surface can change without a declared contract, a fixture result
or route-shape smoke is not proof that the push preserved remote state.
That also means a historical source note does not prove hidden plugin state
discovered after the first write is safe to fold into the earlier approval;
the later surface still needs its own preserve / reject / retry cycle on this
branch.
The source-note comparisons are useful only as context for those failure
classes; they do not prove the current upstream repos still have the cited
behavior, and they do not prove this branch has the same live mutation
boundary today.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Comparison notes can drift from current upstream reality | A doc or status update cites Reprint, ZS-Sync, or ForkPress as if a local note or README snapshot were current upstream proof of behavior today. The claim then inherits upstream semantics without re-verifying the exact upstream commit, branch, or worktree state at the same live mutation boundary. | The audit has comparison notes, but no fresh upstream proof attached to the current claim. There is no evidence that the cited upstream behavior still holds today, or that this branch has matched it at the mutation boundary rather than only in a lab-facing description or route-shaped smoke. | If comparison text can be upgraded into current proof by accident, the project can sound production-ready while still lacking repo-specific evidence for the live write path. |
| Hidden data loss across graph writes | A push edits `wp_postmeta.post_id`, `post_parent`, `_thumbnail_id`, menu links, attachment references, or serialized block payloads while the target identity changed on the remote after pull. A second variant is a same-plan create that invents a new target identity and rewrites relationship rows to point at it. | The current proof only blocks a narrow stale-reference case and explicitly says same-plan identity creation and general rewrite remain unsupported. There is no identity map, rewrite proof, or end-to-end referential integrity test for the affected WordPress graph surfaces, so the push can neither prove safe remapping nor prove it refused the remap. | Without automatic rewrite or a hard block for every graph-mutating class, a push can preserve row hashes while breaking relationships, hiding descendants, or resurrecting the wrong object. |
| New-object identity collisions | Local and remote both create new posts, attachments, terms, or plugin-owned records after the pull base, and the planner later sees matching slugs, import IDs, filenames, or other human-friendly keys. A same-plan create may also be renumbered, aliased, or reassigned during retry. | There is no stable allocation proof that separates "same label" from "same identity" for newly created objects. The docs talk about pull-base binding and graph rewrites, but they do not show a remote-safe identity map, reservation scheme, or replay-safe create mapping for objects that did not exist at base time. | A production push can silently merge or overwrite distinct objects if new identities are inferred from mutable labels instead of a durable identity map. |
| Manual resolution can become stale overwrite permission | An operator selects "take local" after reviewing a conflict, then retries after the remote changed again or after a previous attempt left a mixed state. A second case is an approval recorded for one plan hash and then reused after a different live remote snapshot or a partial recovery replay. A third case is a mixed-scope retry where only part of the plan was approved locally, but the next apply silently reuses that approval for unrelated rows or files. | No reviewed-resolution artifact binds the approval to the exact base/local/remote hashes, reviewer identity, live snapshot timestamp, and retry scope. The docs say manual resolution is only acceptable if the remote is preserved for audit and retry starts from fresh evidence, but the design does not yet show the artifact, server-side enforcement, or retry rejection path when the approved snapshot is stale. Missing proof: a retry after remote drift is rejected before any write, the stale approval remains readable for audit, the rejected artifact cannot be widened into a different row/file/plugin surface, the remote-preserving retry starts from a new snapshot rather than reusing the old decision, a partial approval cannot be broadened to unrelated targets, and a recovered partial apply cannot resurrect the old approval as if it were still current. | A stale manual decision is equivalent to granting overwrite permission on new remote data. |
| Stale approval artifacts can outlive the snapshot they reviewed | A reviewer signed off on a conflict, the remote changed, and a later retry treats the old approval as still valid because the route or package still looks healthy. A second case is a partial apply that produces recovery evidence and then lets the next retry inherit the same approval record instead of re-checking current live hashes. | No proof binds the approval to a single reviewed snapshot, no proof shows the stale artifact is rejected before mutation after drift, and no proof shows the next retry must start from fresh live evidence instead of reusing the old decision. The missing proof is not just that the artifact is readable for audit; it is that it becomes unusable as authority as soon as the remote hashes change. | Keep the stale artifact auditable, but require fresh live hashes and a fresh plan before any retry can authorize write. |
| Plugin data traps remain under-modeled | A plugin stores state in a custom table, generated file, cron row, cache entry, activation hook, serialized option, or runtime-only registry entry not covered by the allowlist. A remote-only plugin update can also change ownership metadata without changing the local plan, leaving a write to an apparently safe row that actually belongs to plugin-managed state. A stale approval can then be replayed against the wrong plugin snapshot and mutate a resource that was never re-reviewed. | The current plan relies on fixture allowlists and a small set of driver checks. It does not define plugin-owned resource graphs, versioned semantics, rollback expectations, or a conservative fallback for unknown plugin state. Missing proof: the planner either enumerates every owned surface for each supported plugin or hard-blocks the push before any write. There is also no proof that ownership changes on the remote are re-evaluated immediately before apply instead of inherited from stale local metadata, or that stale manual approval cannot authorize a different plugin-owned surface after drift. | Production push needs to know what each plugin owns, or it must refuse the push. Guessing is unsafe because plugin state often spans tables, files, runtime side effects, and ownership metadata that can drift independently. |
| False reliability from lab-backed routes | A route looks production-shaped, returns live hashes, and accepts push-like requests, but the implementation still resolves to Playground internals or fixture-only paths. A second variant is a route that reports `finalMatchesLocal` on a fixture while a live source drifts underneath it. | The current evidence repeatedly distinguishes lab-backed route shape from production implementation, but the design does not yet provide a production endpoint that is not lab-backed. The plugin package smoke confirms the route can be mounted as a normal plugin, not that the mutation path is production-safe. Missing proof: the same request must stay safe when replayed against a live source with changed remote state, the route must not depend on copied lab code anywhere in the write path, and a packaged-plugin mount must not be treated as evidence of production mutation semantics. It also lacks proof that a stale approval cannot be replayed through the same route after a fresh live snapshot disagrees, or that route-shape smokes cannot be mistaken for a live write-path guarantee. | A named endpoint is not production support if its success path still depends on copied lab code, fixture scopes, route-shape smoke tests, or stale manual-review artifacts. |
| Fixture success can hide live semantic drift | A lab smoke reports `finalMatchesLocal`, committed replay, or packaged-plugin success on a disposable fixture while the live source has diverged in plugin metadata, graph identity, or custom-table state that the fixture does not model. | The current evidence proves the fixture path can complete and replay, but it does not show the same mutation path against a live remote with changed ownership, remapped identities, or non-fixture side effects. Missing proof: a live-source replay after drift must either preserve the remote or fail closed before any write, and the audit trail must show which production surface was protected. | Fixture success is compatibility evidence, not production safety evidence. If live semantic drift is unmodeled, a green smoke can still mask silent data loss. |
| Recovery claims stop at classification | After a partial apply, the system can label the remote `old-remote`, `fully-updated-remote`, or `blocked-recovery`, but cannot complete a production repair across every boundary. | The recovery docs intentionally stop at lab evidence. They do not prove durable production journals, kill-at-every-boundary replay, or repair across DB, filesystem, plugin activation, and stale-claim lease boundaries. | Production push must survive real crashes, not just classify them after the fact. |
| Storage boundary proof is still fixture-bounded | A remote changes after dry-run but before a MySQL update, file publish, schema write, activation side effect, or plugin publish. | The guarded write proof is limited to specific Playground fixtures and a narrow set of file/database operations. It does not cover arbitrary production inserts, deletes, schema changes, plugin activation writes, or generic compare-and-swap semantics. | Partial success at a narrow fixture boundary is not proof that arbitrary production writes are safe. |
| Coverage gaps can hide unknown remote state | The remote contains mu-plugin settings, WooCommerce HPOS data, Action Scheduler queues, custom tables, generated assets, or multisite data outside the scanner scope. | The design says unknown coverage should block, but no completed production coverage manifest exists that binds every affected surface into the apply evidence. | If the planner cannot prove it saw the resource, it cannot safely mutate it. |

## Still Unproven For Production

These are the specific scenarios that still need direct proof before the branch
can claim production-grade push support:

- A remote edit lands after dry-run and before the first guarded write, and the
  retry is rejected without losing the remote change.
- A create path allocates, renumbers, or remaps an object identity after pull,
  and the planner either rewrites references safely or blocks before any write.
- A plugin owns state outside the allowlist, and the push either discovers that
  ownership or hard-blocks without touching the unknown state.
- A push leaves mixed file, DB, or plugin side effects, and recovery can prove
  whether the target is old, new, or blocked using durable artifacts.
- An operator approves manual conflict resolution once, then the live remote
  drifts before retry, and the stale approval cannot be reused.
- A route-shaped smoke returns a live-looking hash, but the write path still
  resolves to lab internals or fixture-only storage, so the hash is not proof
  of live mutation safety.
- A packaged-plugin mount matches the production path, but the exercised route
  does not preserve the remote or reject stale authority before mutation, so
  packaging shape is only compatibility evidence.
- A manual-review artifact remains readable after drift, but the next apply can
  still widen the old approval to a new row, file, relationship, or
  plugin-owned surface, which is a false-success mode until disproven. The
  missing proof is server-side rejection of that exact artifact as retry
  authority after the remote hash set changes, while preserving it for audit.
- A create path renumbers, aliases, or remaps identity on the live remote, but
  the proof does not show the reservation rule or hard failure that prevented
  reuse of the stale local identity mapping.
- A plugin-owned surface outside the declared allowlist is discovered late, but
  the proof does not show the exact rejection point that kept the unknown
  option, custom table, generated file, activation hook, cron entry, or cache
  side effect from becoming writable.
- A partial file, DB, or plugin write succeeds on one boundary and fails on
  another, but the proof does not show durable classification of the mixed
  result or a retry path that starts from fresh live hashes instead of the old
  approval.
- A claim cites Reprint, ZS-Sync, or ForkPress without naming the exact
  upstream revision or worktree state that was reverified at the same live
  mutation boundary, so the comparison can only be read as historical context.
  The missing proof is not just a citation, but a recheck at the exact live
  write boundary being claimed.

## Release-Grade Rejection Cases

These are the specific conditions that must fail closed before any production
wording is allowed:

- The route shape matches production, but the exercised write path is still a
  lab-backed stand-in or fixture mount, so the remote was never preserved
  through the actual mutation boundary.
- The remote changes after review, but the stale approval is still treated as
  current because the artifact remains readable.
- The approval record can be replayed after drift without binding to the
  fresh live hashes, which means the retry inherited authority instead of
  rebuilding scope.
- The same stale review can be widened to a different row, file,
  relationship-bearing record, or plugin-owned surface, which turns audit
  history into an unsafe capability.
- The source-note comparison looks current, but the cited Reprint, ZS-Sync, or
  ForkPress revision was not reverified at the exact live write boundary, so
  the note is historical context only.
- Plugin-owned state exists outside the allowlist, but the planner still
  treats the unknown surface as safe because the route or fixture path matched
  expectations.
- A create path renumbers or aliases identity after pull, but the proof never
  shows the reservation rule, the remap decision, or the hard failure that
  prevented stale identity reuse.
- A partial file, DB, or plugin apply succeeds on one boundary and fails on
  another, but the next retry can still inherit the old approval or widen it
  to a different surface.
- A manual-review artifact stays readable after drift, but the system cannot
  prove server-side rejection turned it into audit-only evidence before the
  next apply, or that the retry was forced to start from fresh live hashes
  instead of inheriting the old approval.

## What Reprint, ZS-Sync, And ForkPress Actually Contribute

| Source note | What it proves | What it does not prove | Missing repo proof |
| --- | --- | --- | --- |
| Reprint | Transport stages, resumability, protocol framing, and chunked delivery shape. | Live source overwrite safety, drift rejection at apply time, production auth, or durable write semantics. | A live mutation path that fails closed on stale remote hashes and preserves the remote for audit, reverified against the cited upstream state at the same live boundary. |
| ZS-Sync | Bounded discovery, cursor-driven rescans, and changed-resource enumeration. | Write policy, create-time identity reservation, ownership revalidation, or plugin-side effects. | A mutation policy that maps every scanned resource to a safe write rule or a hard block, reverified against the cited upstream state at the same live boundary. |
| ForkPress | Reviewed-resolution vocabulary, crash-consistency language, and merge audit framing. | Proof that this repo has the same live-remote executor, stale-artifact expiry, or partial-apply recovery. | A durable reviewed-resolution artifact that expires on drift and forces retry from fresh live evidence, reverified against the cited upstream state at the same live boundary. |

### Reprint

Reprint gives the transport skeleton: preflight, chunking, resumability, and
protocol versioning. The source notes document pull/export mechanics and a
resumable stage model, not a production write boundary. That is a good
starting point for push, but it is not a proof of live-source safety,
production auth, or rollout behavior. The current design still needs a
production mutation boundary with per-write preconditions, durable journal
semantics, and a recovery artifact that survives failure across file, DB, and
plugin boundaries. It also needs proof that the push path is not just a
mirrored pull pipeline with write verbs attached or a route shape that
happens to return the expected endpoint. A route that only proves endpoint
shape, replay behavior, or packaged-plugin mounting still does not prove live
remote drift handling, identity remapping, or production storage durability.
Reprint's stage-oriented pull notes are useful context, but they do not prove
a retry-safe manual override model for source mutation or a live approval
artifact that expires on remote drift. Unless this branch reverified the exact
upstream revision or worktree at the same live mutation boundary, the note is
historical context only.

### ZS-Sync

ZS-Sync contributes scanner composition and bounded resource enumeration. That
helps the planner know what changed. It does not prove what is safe to mutate.
The source notes document a bounded changed-resource list and continuous rescans,
but not a mutation policy. The current design still lacks a complete coverage
manifest that ties scanner results to every core, plugin, theme, upload,
generated, custom-table, and multisite resource the push can affect. Scanner
cursors and bounded batches are only useful if every enumerated resource
either has a mutation rule or a hard block. Scanner evidence is planning
input, not a write-safety proof, and it does not prove remote drift handling,
create-time identity allocation, or plugin-owned side effects outside the
scanned set.
It also does not prove that a ready plan remains safe after the remote changes
between scan and write. That matters for manual resolution too: the scanner
can tell us what changed, but it cannot prove that an operator approval stays
valid after a fresh live snapshot diverges.
Unless this branch reverified the exact upstream revision or worktree at the
same live mutation boundary, the note stays historical context only.

### ForkPress

ForkPress sets the reliability bar the project must match before it can make a
production claim: three-way merge records, reviewed conflict resolution,
plugin-specific validators, and crash consistency that classifies failure as
old, new, or blocked with artifacts. The current design borrows the vocabulary
but not the proof. In particular, it still needs a resolution artifact that
preserves base/local/remote evidence and forces a fresh live revalidation on
retry. ForkPress is also the warning sign here: reviewed resolution is not a
success path unless the remote is preserved for audit and the next retry
re-plans from fresh evidence. ForkPress is the comparison point, not a
guarantee that this branch has matched it. Its merge and crash-consistency
vocabulary is therefore a bar for auditability, not proof that a lab-backed
push endpoint can safely claim production support. ForkPress's notes are still
missing the repo-specific proof we need here: a durable reviewed-resolution
artifact, expiry on stale approvals, and a remote-preserving retry path after
a second drift.
Unless this branch reverified the exact local worktree state at the same live
mutation boundary, the note is historical context only.

## Production Claim Checklist

Before the project can use production-grade push wording, the audit needs
evidence for all of these, not just a plausible design or a route-shaped
smoke:

The compact release gate lives in [`audits/release-gate.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/critic/audits/release-gate.md); it is the shorter checklist for docs, PRs, review comments, and status updates.
Its purpose is to prevent a lab-shaped route, a package-mounted smoke, or a `finalMatchesLocal` match from being read as proof that the live write path preserved the remote.

### Release-Grade Wording Gate

Any public-facing claim that the project has production-grade push support must
explicitly satisfy all of the following. If any item is missing, the wording
must stay lab-backed or comparison-only.

Separate compatibility evidence from live write-path proof: a route-shaped
smoke, packaged-plugin mount, `finalMatchesLocal` match, or source-note
comparison can support context, but none of them prove production mutation
safety unless the same request path was exercised against a drifted live
remote and the stale approval failed closed before mutation.

The project also still needs direct proof for these five failure classes before
any production-grade wording is defensible:

- live remote drift between dry-run and apply, with a failed-closed apply that preserves the rejected remote for audit;
- create-time identity remapping, with either durable reservation or a hard block before write;
- plugin-owned state outside the allowlist, with unknown surfaces hard-blocked rather than guessed;
- partial file, DB, or plugin side effects, with durable old/new/blocked classification and no scope widening on retry; and
- stale manual-review artifacts that outlive the snapshot they reviewed, with the stale artifact remaining readable but unusable as authority.

Treat the following as hard blockers for production wording:

- any claim that treats route shape, packaged-plugin mounting, or `finalMatchesLocal` as proof of production mutation safety;
- any claim that cites Reprint, ZS-Sync, or ForkPress as current proof without naming the exact upstream revision or worktree state that was reverified;
- any claim that says manual resolution is enough without proving the remote was preserved, the stale artifact failed closed, and the retry rebuilt scope from fresh live evidence;
- any claim that leaves create-time remap, plugin-owned allowlist coverage, or partial side-effect classification unspecified for the exercised write path.

- Name the exact live write path that was exercised, not just the route shape,
  packaged-plugin mount, fixture replay, or `finalMatchesLocal`.
- Name the stale remote-drift case that was rejected before mutation.
- Name the preserved remote snapshot or hash set that made the stale approval
  auditable but unusable for apply.
- Name the retry scope rebuilt from fresh live evidence after drift.
- Name the exact upstream revision or worktree state that was reverified for
  any Reprint, ZS-Sync, or ForkPress comparison.
- Name the concrete boundary that proves the wrapper was not the proof: the
  exact request path, auth mode, and storage boundary that were exercised
  against a drifted remote, not just a matching endpoint name or package
  layout.
- Name the exact request path and repo state used for the drifted-remote proof;
  a lab-shaped route or package mount is only compatibility evidence unless it
  exercised that exact boundary.
- Name the create-time identity case and whether it was safely remapped or
  hard-blocked.
- Name every plugin-owned surface that was proven safe or explicitly blocked,
  including options, custom tables, generated files, activation hooks, cron,
  cache state, and other plugin side effects.
- Name how plugin-owned ownership changes are revalidated at apply time, or
  show that the surface is hard-blocked before any mutation.
- Name the partial file, DB, or plugin side effect class that was classified
  durably and how the next retry was forced to start from fresh evidence.
- Name the exact upstream Reprint, ZS-Sync, or ForkPress revision or worktree
  state that was reverified, or say that the comparison is historical context
  only.
- State whether the comparison was reverified at the exact live mutation
  boundary; if not, it stays historical context and cannot be promoted into
  current proof by matching route shape or package layout.
- State whether the stale manual-review artifact stays readable for audit but
  cannot authorize a widened retry after remote drift.
- Name the exact stale snapshot or live hash set that invalidated the old
  approval and the replay-safe boundary that prevented reuse.
- Avoid phrases like "production-safe," "production-ready," or "supports
  production push" unless the proof above is attached to the current claim.

- The source notes for Reprint, ZS-Sync, and ForkPress are treated as
  conservative design input only. They do not prove live remote drift
  rejection, stable identity reservation for creates, plugin-owned state
  revalidation, durable recovery, remote-preserving retry after drift, stale
  manual-review artifact rejection, or a production write boundary in this
  repo.
- Any claim that cites Reprint, ZS-Sync, or ForkPress must name the exact
  upstream commit or worktree state that was reverified and the exact live
  write boundary that was exercised. If either is missing, the citation is
  historical context only and cannot support production wording.
- A cited upstream commit or worktree state is still not current proof unless
  this branch replayed the same live mutation boundary against that exact
  upstream state and recorded the stale-approval rejection that protected the
  remote.
- An unverified Reprint, ZS-Sync, or ForkPress comparison is never current
  proof, even when the path, package shape, or expected hash looks
  production-shaped.
- The observed upstream commit or worktree state in the source notes is
  historical context only. It cannot be treated as current upstream proof
  unless this branch re-verifies the same behavior at the live mutation
  boundary and records the exact evidence for the current claim.
- A lab route, fixture route, packaged-plugin route, or copied source-note
  route shape is compatibility evidence only. It does not prove production
  auth, production storage durability, live remote preservation, or that the
  exercised route is the real write executor instead of a lab-backed stand-in.
  Matching ingress or endpoint names is not enough to turn a lab-backed route
  into production proof, and a mounted plugin shell is not proof that the live
  mutation boundary ran.
- Those notes also do not justify production wording by association. A future
  doc or status comment must still show live write-path proof in this repo; a
  strong transport shape, scanner model, or crash vocabulary is not enough.
- Those notes also do not prove that a stale approval stays auditable while a
  retry preserves the remote, re-plans from fresh evidence, and rejects any
  widened scope before write.
- A real production Reprint push endpoint that does not resolve to Playground
  or copied lab internals, plus a repo-specific proof that package mounting
  only exposes the endpoint shape rather than the write-path semantics. A
  mounted route that returns live-looking hashes still does not prove the
  production executor ran; it can still be a fixture-backed or copied-lab
  stand-in that happens to answer on the right path.
- A stale review artifact tied to one live snapshot cannot become current
  authority just because the route still looks healthy. The proof must show
  the exact live snapshot that invalidated it, the remote-preserving audit
  trail, and the fresh retry scope.
- Audit visibility is not retry authority: if the stale artifact can still be
  reused against a different row, file, relationship-bearing record, or
  plugin-owned surface after drift, then the claim is not production-grade.
- A release-gate proof that a stale review artifact remains readable for
  audit but cannot authorize apply after the remote changes, cannot be
  widened to a different row, file, or plugin-owned surface, and is
  invalidated by the exact live snapshot that broke the match.
- The source-note snapshots themselves are not current upstream proof: a
  locally observed commit, worktree state, or README claim in Reprint, ZS-
  Sync, or ForkPress only anchors the comparison text. It does not prove that
  the upstream repo still has the cited semantics today or that this branch
  has matched them at the mutation boundary.
- If the comparison does not pin the exact upstream commit hash or worktree
  state that was reverified at the live write boundary, then it is historical
  context only, even if the route, package, or hash shape looks current.
- Any future comparison claim that leans on those notes must also re-verify
  the current upstream commit or worktree state; otherwise the note is only
  historical context and cannot support production wording.
- Any release note, PR description, review comment, or status comment that
  cites the source notes must state whether the upstream behavior was
  re-verified against the current commit or worktree state; if it was not,
  the note is comparison context only and cannot support production wording.
- A doc, PR description, review comment, or status comment must never treat a
  route-shape smoke plus a source-note citation as production proof. If the
  source note was not re-verified against the current upstream commit or
  worktree, the claim is still historical context and the live write path
  remains unproven.
- A lab-shaped route that merely matches ingress, route name, or package
  layout is still compatibility evidence only; it does not prove the
  production executor ran, that remote drift was checked at the write
  boundary, or that the remote was preserved for audit before retry.
- A plugin-owned write outside the allowlist is only acceptable if the audit
  shows the exact owned surface, the live revalidation that checked it, and
  the failure path when that surface drifted or was discovered late.
- A plugin-owned write justified only by route shape, package mount, or
  `finalMatchesLocal` is not production proof. The audit still needs the live
  owned surface, the revalidation point, and the failure path for late
  discovery or remote drift.
- A route that looks production-shaped, returns live hashes, or passes a
  packaged-plugin smoke must still be proven against a live remote with drift;
  those results are compatibility evidence only and do not prove production
  write safety, credential isolation, or durable retry behavior.
- The same warning applies to `finalMatchesLocal`: a fixture-level match only
  proves the lab surface converged, not that the live remote was preserved or
  that a stale approval was rejected before write.
- Manual resolution is only acceptable if the remote is preserved for audit,
  the stale approval stays readable but unusable, server-side rejection forces
  the next retry to start from fresh live hashes and a fresh plan, and the
  rejected artifact cannot be widened to a different row, file, or
  plugin-owned surface.
- Route shape, packaged-plugin smoke results, and fixture `finalMatchesLocal`
  outputs are compatibility evidence only; they are never sufficient by
  themselves to claim production mutation safety, credential isolation, or
  remote-preserving retry semantics. A live-looking hash on any of those
  paths is still only evidence that the route answered, not that the live
  remote was preserved, the stale approval failed closed, or the retry scope
  was rebuilt from fresh evidence.
- A packaged-plugin mount or route-shape smoke that returns live-looking
  hashes still does not prove the write path is the production executor, that
  stale review artifacts are rejected before mutation, or that the retry path
  preserves the remote after drift.
- A successful route-shape or packaged-plugin smoke must never be cited as
  evidence that live remote drift was handled safely; if the source changed
  after review, the only valid proof is a fresh live snapshot, a rejected stale
  approval, and a retry that starts from the new evidence.
- A route that reports `finalMatchesLocal`, committed replay, or packaged
  plugin success on a fixture must still prove fresh live-remote
  revalidation; those results do not prove create-time identity remapping,
  plugin-owned state outside the allowlist, or protection from partial
  file/DB/plugin side effects.
- A lab route-shape smoke or packaged-plugin mount that returns live-looking
  hashes must never be upgraded into a production claim unless the same write
  path was exercised against a live remote after drift and the evidence shows
  the remote was preserved or the write failed closed.
- A review note, PR description, or status comment that says "same as
  upstream," "package smoke passed," or "route shape matches" still needs the
  live proof bundle. Without the rejected stale approval, preserved remote,
  fresh snapshot, and exact reverified upstream revision or worktree state,
  the wording stays comparison-only and cannot claim production support.
- `finalMatchesLocal`, committed replay, or packaged-plugin success on a
  fixture never prove the same path is safe against live remote drift in
  plugin metadata, graph identity, custom-table state, or create-time identity
  remapping.
- A route that only proves route shape or fixture replay must still fail
  closed on stale manual-review artifacts, because a stale approval is not
  current authority for a live retry.
- Reprint, ZS-Sync, and ForkPress notes are comparison evidence only; they
  do not prove live remote drift handling, stable create identity, plugin
  ownership revalidation, or crash-safe production writes in this repo.
- Live-remote revalidation immediately before apply, with stale retries
  rejected before any write and with the rejection tied to the live hashes
  that failed validation.
- A complete coverage manifest for core, plugin, theme, upload, generated,
  custom-table, and multisite resources, with unknown ownership treated as a
  hard block.
- A plugin ownership contract for tables, files, options, cron, cache,
  activation hooks, and other side effects, with explicit rollback or block
  behavior.
- Graph identity mapping or an explicit hard block for every relationship-
  bearing row class that can silently rewire references.

## Release Gate For Production Wording

Do not let a doc, PR description, review comment, or status update claim
production-grade push support unless every item below is true and evidence is
attached to the current commit or worktree state:

- The claim cites a live write-path proof, not only a route-shape smoke,
  packaged-plugin mount, fixture replay, or `finalMatchesLocal` result.
- Any comparison to Reprint, ZS-Sync, or ForkPress states whether the source
  note was re-verified against the current upstream commit or worktree state.
- The claim shows what happens when the remote drifts after dry-run and before
  apply, and the stale attempt fails closed before any mutation.
- The claim shows how create-time identity remapping is either safely
  represented or hard-blocked before write.
- The claim shows how plugin-owned state outside the allowlist is discovered
  or blocked, including options, custom tables, generated files, activation
  hooks, cron, and cache side effects.
- The claim shows how a partial file, DB, or plugin apply is classified
  durably and how a retry starts from fresh evidence instead of reusing stale
  approval.
- The claim shows that a manual-resolution artifact remains readable for
  audit but cannot be reused or widened after the live snapshot changes.
- The claim does not rely on "manual resolution will handle it later" unless
  the remote is preserved for audit and the retry path is explicitly
  replay-safe.
- Reviewed conflict artifacts that preserve base/local/remote evidence,
  reviewer identity, chosen action, and fresh revalidation data.
- Rejected retries must stay auditable, but they must not be allowed to
  execute from the old approval record, and a partial approval must never be
  widened to unrelated rows, files, or plugin-owned surfaces on retry.
- A reviewed manual-resolution artifact is not success on its own; the retry
  must preserve the remote, bind to the exact stale snapshot that was
  reviewed, reject the stale artifact before any write, and force a fresh
  plan before any write.
- A stale manual-review artifact is never current authority; it may stay
  auditable, but it cannot authorize a retry after remote drift or after a
  partial approval has already been recorded, and it cannot be upgraded by a
  later route-shape smoke or packaged-plugin mount.
- A stale approval must remain an audit record only: the next retry has to
  start from fresh live evidence, and the old record must not be reused to
  authorize a different row, file, or plugin-owned surface.
- A production claim must also show a negative test for plugin-owned state
  outside the allowlist, including at least one of options, custom tables,
  generated files, activation hooks, cron, or cache side effects, or else the
  design must hard-block that surface before apply.
- A production claim must not rely on the observed commit or worktree in
  `docs/source-notes.md` as current upstream proof unless the same upstream
  behavior was re-verified and attached to the current claim.
- Production wording is blocked unless the claim names the exact live-write
  boundary it exercised in this repo; route-shape, packaged-plugin mounting,
  `finalMatchesLocal`, and benchmark throughput models are compatibility
  signals only and never production proof by themselves.
- Any claim that cites Reprint, ZS-Sync, or ForkPress source notes must also
  say whether the cited upstream behavior was re-verified against the current
  commit or worktree state. If it was not re-verified, the note is comparison
  context only and cannot support production wording.
- A production-language claim must include the live remote drift case it used,
  the stale approval that was rejected, and the fresh retry evidence that
  rebuilt scope from current hashes rather than reusing the old decision.
- A comparison note that is missing the exact upstream commit hash or worktree
  state is not a production proof, even if it names the same project or
  feature; the claim still needs the live mutation boundary in this repo.
- Durable journals and kill-at-every-boundary recovery proofs across DB,
  filesystem, and plugin boundaries.

## Release Gate

Do not allow production-grade push wording unless every item below is true in
repo-specific evidence, not in lab shape or source-note comparison language:

- A live remote drift between dry-run and apply is rejected before any write,
  and the rejection cites the exact live hashes that failed validation.
- A create-time identity reservation exists, or the plan hard-blocks every
  create that could be renumbered, aliased, or remapped on the remote.
- Every plugin-owned surface touched by push is either enumerated in the
  coverage manifest or hard-blocked before apply.
- A stale manual-review artifact is rejected before write, remains available
  for audit, and cannot be reused to authorize a widened scope after live
  drift or partial failure.
- Partial file/DB/plugin side effects are classified as blocked recovery, not
  as success, unless the audit shows a remote-preserving retry path with fresh
  evidence and no untracked writes outside the intended boundary.
- The release gate includes an evidence pack that names the exact live hashes,
  the rejected stale approval, the retry scope, and the proof that any
  plugin-owned surface outside the allowlist was either blocked or covered.
- A stale manual-review artifact is rejected before write, remains auditable
  for retry review, and cannot be reused after the remote changes.
- A partial recovery replay cannot resurrect or widen the old manual-review
  artifact; the replay must stay audit-only until a fresh live snapshot and
  fresh plan have been recorded for the exact retry scope.
- Route-shape smokes, packaged-plugin mounts, and fixture `finalMatchesLocal`
  results may appear in evidence, but they cannot be cited as production proof
  unless the same write path was exercised against a live remote after drift.
  A live-looking hash from a mounted route is still compatibility evidence
  only until the audit identifies the exact write executor and the exact
  remote-drift rejection that happened on that request path.
- Partial file, DB, or plugin side effects are classified with durable
  artifacts that survive retry and preserve the remote for audit.
- A manual-resolution artifact is bound to the exact stale snapshot it was
  reviewed against, remains auditable, and cannot authorize a widened retry.
- A retry after stale approval starts from fresh live evidence and cannot
  reuse an old route-shape smoke, packaged-plugin smoke, or `finalMatchesLocal`
  result as authority.
- The evidence shows the write path is the production executor, not a
  Playground-backed or fixture-backed stand-in that only matches the route
  shape.
- A release gate that runs the full safety-critical suite before any
  production claim ships, and that gate must fail closed on stale manual
  review artifacts, unknown plugin ownership, route-shape-only evidence, or
  fixture-only replay evidence.
- False reliability claims are not allowed: a route-shape smoke, packaged
  plugin mount, or `finalMatchesLocal` result cannot be summarized as
  production-safe, retry-safe, or durable unless the live write path, fresh
  snapshot, and stale-artifact rejection have all been proven on the same
  request path. Live-looking hashes do not change that standard, and they do
  not justify production wording by association. If the only evidence is a
  lab or fixture route that happens to emit the expected hash, the claim must
  stay explicitly compatibility-only.
- Any doc, PR description, review comment, or status comment that cites the
  source notes must state whether the cited upstream behavior was re-
  verified against the current commit or worktree state. If not, the wording
  must remain comparison-only and may not imply production support.

## Release Gate Checklist

Use this checklist before any doc, PR, or status comment says the project has
production-grade push support:

- Route shape, packaged-plugin mounting, and `finalMatchesLocal` are
  compatibility checks only. They do not prove production safety, because they
  can succeed while the live remote has drifted, the write path is still
  lab-backed, or stale manual-review artifacts are being reused.
- A route-shape smoke, packaged-plugin mount, or fixture replay must never be
  promoted into production wording unless the same request path was exercised
  against a live remote after drift and the stale approval failed closed before
  mutation.
- If the only evidence is route shape, package mounting, or `finalMatchesLocal`
  plus a stale or unverified review artifact, the wording must stay explicitly
  lab-backed and cannot imply production safety by association.
- A production claim must show the live remote was revalidated at the actual
  apply boundary, not just during dry-run or fixture planning.
- A production claim must fail closed on create-time identity remapping unless
  the repo proves durable identity reservation and reference rewriting for that
  exact live object class.
- A production claim must fail closed on plugin-owned state outside the
  declared allowlist, including plugin tables, options, generated files,
  activation side effects, cron, and cache state, plus any custom-table or
  file ownership the plugin can rewrite, unless a semantic driver proves the
  mutation surface exactly.
- A production claim must fail closed on any stale manual-review artifact that
  can still be read for audit but no longer matches the live snapshot, plan
  hash, or retry scope.
- A production claim must fail closed on partial file/DB/plugin side effects;
  a split remote state is not success unless the remote is preserved for audit
  and the retry path can prove safe recovery from fresh evidence.
- A production claim must not cite Reprint, ZS-Sync, or ForkPress notes as
  current upstream proof. Those notes can justify comparison language only;
  they do not prove today's upstream behavior or this repo's live mutation
  boundary.
- A stale manual-review artifact may stay readable for audit, but it must not
  be treated as current authority after remote drift or partial apply.
- A stale manual-review artifact must be shown rejected against the live
  remote before any retry or production wording can be claimed; a lab-shaped
  route, packaged-plugin mount, or `finalMatchesLocal` smoke cannot stand in
  for that rejection, and the retry must start from a fresh snapshot plus a
  fresh plan.
- A partial recovery replay must fail closed if it tries to reuse the old
  approval record, even when the replay is otherwise able to classify the
  target as old, new, or blocked.
- Production push endpoint: the exercised write path must be the real
  production-backed source mutation path, not a Playground proxy, route-shape
  stand-in, or copied lab executor.
- Fresh remote proof: apply must re-read the live remote immediately before
  the first guarded write, and any stale hash or stale manual review artifact
  must fail closed before mutation.
- Retry proof: if a retry is allowed after drift, the next run must start from
  a fresh snapshot and a fresh plan, not from the old approval record.
- Smoke-proof boundary: route-shape, packaged-plugin, and `finalMatchesLocal`
  smokes are compatibility checks only; they cannot be used to claim
  production write safety, stale-approval validity, or remote-preserving retry
  behavior.
- Auditability boundary: manual review is only acceptable if the remote stays
  preserved, the approval is bound to a fresh live snapshot, and the retry
  path rejects the stale approval before any write.
- Comparison boundary: Reprint, ZS-Sync, and ForkPress can justify design
  direction, but they do not prove the live production executor exists in this
  repo or that it is safe under drift.
- Audit-boundary proof: a rejected stale approval must remain readable for
  audit while being unusable for write authorization, and the retry must be
  tied to the new live hashes.
- False-reliability proof: if the only evidence is a route-shaped response,
  packaged-plugin mount, or fixture replay, the branch must say lab-backed
  only and may not imply production safety, retry safety, or remote-
  preserving behavior.
- Identity safety: create paths must either reserve stable identities or
  block; a retry may not renumber or remap identities from stale local
  assumptions.
- Identity proof must be durable, not inferred from a label match: if create
  paths can rename, alias, or remap records after planning, the design must
  prove a reservation or allocation record that survives drift, not a best-
  effort lookup from the old plan.
- Plugin ownership safety: every plugin-owned table, file, option, cron,
  cache, activation, and generated surface in scope must be explicitly
  enumerated or hard-blocked, and remote ownership drift must be revalidated
  before write. Unknown plugin-owned state outside the manifest is a hard
  block, not a candidate for manual resolution, and stale approval cannot be
  reused to touch a different plugin-owned surface on retry.
- Partial-side-effect safety: a failure that leaves mixed file, DB, or plugin
  effects must produce durable artifacts that classify the target as old,
  fully updated, or blocked recovery without pretending the push succeeded.
- Auditability: the review artifact must bind to the exact base/local/remote
  hashes, reviewer identity, live snapshot timestamp, and retry scope so the
  remote can be preserved and the operator can safely retry or inspect later.
- Stale-approval handling: if the remote changes after review, the old
  approval must stay readable for audit but the retry must be rejected before
  any write and forced to start from a fresh live snapshot. A retry may not
  reuse an old approval record to widen scope, cross rows, or touch a
  different plugin-owned surface.
- Claim-language gate: any doc, PR, branch status, review comment, status
  comment, or release note that says `production-grade`, `production support`,
  or `production-safe` must cite the live write path, fresh remote
  revalidation, and stale-approval rejection; route-shape smoke,
  packaged-plugin mount, or `finalMatchesLocal` alone is never enough, and a
  status update must not imply production safety by association with the
  source-note comparison.
- Lab-shape guardrail: a route-shape smoke, packaged-plugin mount, or
  fixture `finalMatchesLocal` result may only be described as lab or
  compatibility evidence; it must not be reframed as proof that the live
  write path is production-safe, remote-preserving, or retry-safe.
- Manual-review proof: the review artifact must show the exact base/local/
  remote hashes that were reviewed, the reviewer identity, and the live
  snapshot timestamp, and it must fail closed if any of those change before
  apply.
- Stale-artifact expiry: a review artifact may remain auditable, but any live
  hash mismatch must invalidate it for authorization on the next retry, route
  mount, or packaged-plugin smoke, and the new run must start from fresh live
  evidence.

## Must-Have Proof Before Production Wording

A future production claim is still blocked until the repo can show all of the
following on the live push path, not on a fixture or route-shape smoke:

- Route shape, packaged-plugin mounting, and `finalMatchesLocal` remain
  compatibility checks only. They are never enough to establish production
  safety if the live remote was not revalidated against the same write path.
- A live production executor path that is not a Playground proxy, copied lab
  helper, or fixture-backed stand-in.
- A fresh remote re-read immediately before the first guarded write, with stale
  hashes and stale manual-review artifacts rejected before any mutation.
- A remote-preserving retry flow that starts from a new snapshot and a new plan
  after drift, while keeping the rejected artifact readable for audit only.
- Identity reservation or a hard block for creates, with proof that the retry
  path cannot silently remap relationships to a new object.
- A plugin ownership manifest that covers every owned table, file, option, cron,
  cache, activation, generated, and runtime side effect in scope, with unknown
  surfaces blocked instead of guessed.
- Durable crash classification that can say old, new, or blocked after partial
  file, DB, or plugin side effects, without reporting success from an
  incomplete apply.
- A review artifact that binds the exact base, local, remote, reviewer, live
  snapshot timestamp, and retry scope, and that cannot be widened to a different
  row, file, or plugin-owned surface.
- Source notes from Reprint, ZS-Sync, and ForkPress remain comparison evidence
  only. They can explain why a design choice is plausible, but they do not
  prove this repo has a live mutation boundary, stale-artifact rejection, or
  remote-preserving retry at the production executor.
- Any comparison claim that cites those notes must also name the current
  upstream commit or worktree state that was re-verified for the same claim;
  otherwise the note stays historical context and cannot be promoted into
  production wording.

If any one of those proofs is missing, the branch can describe the design, but
it cannot claim production-grade push support.
- Evidence standard: fixture replay, route-shape smoke, and packaged-plugin
  mounting are compatibility checks only; none may be cited as proof of
  production safety, even if they return live-looking hashes or `finalMatchesLocal`.
- Claim hygiene: any doc, PR, or status comment that says or implies
  `production-grade`, `production support`, or `production-safe` must cite
  live remote revalidation immediately before write, stale-artifact rejection,
  and a repo-specific production mutation path. If that proof is missing, the
  wording must stay explicitly non-production.

## Changes Required Before A Production Claim

These are not optional hardening ideas. Each item closes a specific failure
mode where the current evidence still allows silent data loss, stale retries,
or an operator-facing success message that is stronger than the proof.

1. Ship a real production push endpoint whose implementation does not route to
   Playground or lab internals, and prove the live write path still works when
   the remote drifts between dry-run and apply, including the case where a
   stale approval exists but must be rejected before write. The proof must
   show the remote stayed auditable, the stale record became unusable, and the
   retry started from fresh live evidence.
2. Separate lab credentials from production push credentials and prove
   production lifecycle behavior: issuance, scoping, rotation, revocation,
   replay rejection, and audit retention.
3. Introduce a complete production coverage manifest and make unknown plugin,
   custom-table, generated-file, cache, and multisite resources hard blocks.
   Missing proof: a live remote plugin-owned surface outside the manifest is
   rejected before any write, even if a route-shape smoke, packaged-plugin
   mount, or `finalMatchesLocal` result looks healthy.
4. Define plugin-owned resource contracts for tables, files, options, cron,
   cache, activation hooks, and generated side effects, with rollback or
   block behavior for unknown ownership and for ownership changes discovered
   immediately before apply. Missing proof: a plugin-owned option or custom
   table changed on the remote after review and the apply rejected before any
   write instead of silently reusing stale assumptions.
5. Add graph identity mapping, including stable allocation for new objects, or
   broaden the hard block policy so every relationship-bearing WordPress row
   class that can silently rewire identity is either rewritten safely or
   rejected.
6. Add a replay-safe identity reservation model for creates, or hard-block any
   create path that can be renumbered, aliased, or reassigned by the live
   remote after planning. Missing proof: a freshly created attachment, term, or
   plugin record cannot be remapped by a concurrent remote write into a
   different identity while the push still reports success.
7. Add reviewed conflict-resolution artifacts that preserve base/local/remote
   evidence, reviewer identity, chosen action, and fresh revalidation data.
   The approval must bind to a specific live snapshot and expire on any remote
   drift so a retry cannot reuse stale manual permission. Rejected retries
   must stay auditable, but they must not be allowed to execute from the old
   approval record.
8. Extend storage-boundary checks to production write primitives, including
   inserts, deletes, schema changes, file publish/unlink, plugin activation
   side effects, and any write path that can expose mixed old/new state after a
   partial write. The proof must cover file-only, DB-only, and plugin-only
   failures separately, not just a happy-path combined commit.
9. Build a durable production journal with kill-at-every-boundary tests across
   DB, filesystem, plugin activation, and stale-claim recovery. Missing
   proof: a partial apply never reports success while any one of those
   boundaries remains in a mixed state.
10. Add tombstone and resurrection policy for delete/restore cases so a retry
    cannot silently revive intentionally deleted remote content.
11. Publish production audit/redaction schemas and a release gate that runs the
    full safety-critical suite before the project can use production-grade
    wording.
12. Prove the push endpoint is genuinely production-backed rather than a
   production-shaped route that still resolves to lab or Playground code.
   Missing proof: the same request path stays production-backed after a
   remote drift event and does not silently fall back to fixture behavior.
13. Prove the claimed reliability wording against live source mutation, not
   against fixture replay, route-shape smoke tests, or model-only recovery
   classification. Missing proof: the wording must be backed by a live apply
   that rejects stale approval before any write and preserves the remote for
   audit.
14. Keep route-shape and packaged-plugin smokes explicitly labeled as
    lab-backed evidence only, with no production-readiness inference attached.

If any one of these remains unproved, the correct claim stays limited to
fixture-scoped or lab-backed push evidence.

## Production Release Gate

Use this as the minimum bar before any doc, PR, branch, or status note says
`production-grade`, `production support`, or any equivalent claim.

- The push path is a real production endpoint and does not resolve to
  Playground, fixture, or copied lab internals.
- Route-shape matches, packaged-plugin mounting, and `finalMatchesLocal`
  outputs remain lab evidence only; they do not count as production mutation
  proof, and they do not prove live-remote drift safety, create-time identity
  stability, or plugin-owned state safety even when the endpoint name looks
  correct.
- A route-shaped response with live-looking hashes still does not prove the
  production executor is in the path.
- A route-shaped response, packaged-plugin mount, or `finalMatchesLocal`
  smoke does not prove current upstream behavior in Reprint, ZS-Sync, or
  ForkPress unless that upstream state was re-verified at the same revision.
- A lab route that looks production-shaped is not production proof, even if it
  returns live hashes, mounts as a plugin, or replays successfully on a
  fixture. Those results only show compatibility with the lab path that was
  exercised; they do not prove the live source mutation path is safe against
  remote drift, identity remapping, or plugin-owned side effects.
- A source-note comparison to Reprint, ZS-Sync, or ForkPress is not current
  production proof, even if the notes describe a similar transport, scan, or
  merge vocabulary; the repo still needs its own live mutation evidence on the
  same request path.
- A comparison note from Reprint, ZS-Sync, or ForkPress can justify a design
  choice, but it cannot be promoted into current proof without fresh upstream
  verification and a live remote revalidation on this repo's write path after
  drift. The note remains context, not authority, even if the same endpoint
  name or route shape appears in a smoke.
- If a comparison claim does not attach the current upstream commit or
  worktree state that was re-verified, the note is historical context only
  and must not be used to imply a live production mutation boundary.
- Reprint, ZS-Sync, and ForkPress source notes are comparison evidence only;
  they do not transfer safety proof to this repository by resemblance alone.
  Their notes can justify transport shape, scanner shape, or reliability
  vocabulary, but they do not prove this repo's live write path, identity
  reservation, plugin ownership enforcement, stale-artifact rejection, or
  crash recovery.
- No design claim may cite those notes as proof that this repo has already
  matched their safety bars; the repo still needs its own live drift,
  identity, plugin-ownership, and crash-recovery proof at the mutation
  boundary.
- The live remote is revalidated immediately before apply, and any stale
  retry starts from a fresh snapshot rather than reusing old approval or stale
  manual-review artifacts.
- Manual resolution only counts as success when the remote is preserved for
  audit, the review artifact is bound to the exact live snapshot that was
  approved, and the next retry re-plans from fresh evidence. A stale approval
  that merely “looks reasonable” is not production proof.
- A rejected manual-review artifact must remain readable for audit, but it
  cannot be widened, repurposed, or reused to authorize a broader retry scope
  after remote drift or partial apply recovery.
- A stale approval, stale snapshot, or stale manual-review artifact cannot be
  recycled as evidence for a new apply, even if the plan hash or endpoint name
  has not changed. If the remote drifted, the old record stays auditable but
  unusable, and the next retry must start from fresh live evidence.
- A green route-shape smoke or packaged-plugin mount does not refresh a stale
  manual-review artifact; those signals stay lab evidence only and cannot turn
  old approval into current authority.
- A stale manual-review artifact must be rejected before write even when the
  route shape matches, the plugin package mounts cleanly, or a fixture replay
  returns `finalMatchesLocal`; those signals remain lab evidence only.
- The first live-hash mismatch must invalidate the approval before any write,
  even if route-shape smoke, packaged-plugin mounting, or fixture replay still
  looks healthy.
- A stale manual-review artifact may stay readable for audit, but once the
  live remote hash or snapshot timestamp changes it is no longer current
  authority and cannot be widened to a different row, file, or plugin-owned
  surface, even if a later route-shape or packaged-plugin smoke still passes.
- Any reviewed approval artifact must bind to the exact base, local, remote,
  and coverage hashes that were reviewed. If any of those hashes change, the
  old artifact remains audit evidence only and cannot authorize a retry.
- Any reviewed approval artifact must also bind to the exact live snapshot
  identifier and retry scope; if the live snapshot changes or the scope
  expands, the artifact is audit-only and the next apply must start from a
  fresh review.
- A route-shape match, package mount, or `finalMatchesLocal` result never
  proves the live snapshot still matches the reviewed approval; those signals
  stay compatibility evidence only, even when they return live-looking hashes.
- Every mutation surface has an explicit coverage manifest entry, or the push
  hard-blocks before apply. Unknown plugin-owned state is not "covered by
  inference"; it is a block.
- Every plugin-owned resource has a declared contract, or the push hard-blocks
  before apply.
- Every graph-bearing row class either has a proven rewrite rule or is
  rejected before mutation.
- Every conflict resolution writes a reviewed artifact with base, local,
  remote, reviewer, action, and fresh revalidation evidence, and stale
  artifacts cannot authorize a retry.
- A partial conflict resolution cannot be widened on retry; the next apply must
  revalidate the exact approved scope or reject before any write.
- A release gate is not satisfied by a route-shape smoke, packaged-plugin
  mount, or `finalMatchesLocal` result unless the same live write path also
  proved stale-approval rejection, remote preservation, and fresh-snapshot
  retry after drift.
- Route-shape matches, packaged-plugin mounting, and `finalMatchesLocal`
  results are compatibility evidence only. They must not be used as proof of
  production mutation safety, live-remote drift handling, or current-release
  readiness.
- Every apply boundary has durable recovery evidence that can classify the
  target as old, new, or blocked after a crash.
- Every production-readiness claim must separate compatibility evidence from
  mutation proof; route shape, packaged-plugin mounting, and `finalMatchesLocal`
  never qualify as production safety evidence on their own.
- Every partial side effect path is either rolled back, fenced, or preserved
  for audit and retry with no false success claim.
- Every route-shape, packaged-plugin, or `finalMatchesLocal` smoke remains
  labeled as lab evidence only and cannot be used as proof of production
  mutation safety or live-remote drift handling.
- Every production-readiness statement in docs, PRs, branch status, review
  comments, or release notes is backed by the live production path, fresh
  remote evidence, and a current reviewed artifact; route shape, fixture
  replay, and packaged-plugin smoke results never qualify on their own, even
  if they expose the expected endpoint name or response shape.
- Any stale manual-review artifact, stale live-remote snapshot, or lab-backed
  endpoint evidence must fail the release gate before production wording is
  allowed.
- A retry after remote drift must prove the old manual-review artifact was
  rejected before write and that the new apply started from a fresh live
  snapshot, not from reused approval or route-shape smoke results.
- A partial recovery replay is audit evidence only until the fresh snapshot,
  fresh plan, and retry scope are re-established; it cannot be treated as a
  successful resurrection of the prior approval.
- Rejected manual-review artifacts must remain readable for audit, but they
  cannot be widened, repurposed, or treated as current authority for a
  different retry scope.
- A stale manual-review artifact that once matched the plan hash must still be
  rejected if the live remote snapshot, coverage hash, or retry scope has
  changed.
- The release gate fails closed on live remote drift, identity remapping on
  create, plugin-owned data outside allowlists, partial file/DB/plugin side
  effects, and stale manual-review artifacts even when a lab smoke passes.
- The release gate also fails closed if a stale review artifact was created
  before a partial recovery replay and the retry would reuse it to authorize a
  different row, file, or plugin-owned surface.
- The release suite runs the production-shaped auth, storage, recovery,
  plugin, graph, and audit checks together, not as isolated smoke tests.
- The gate fails closed if a retry would reuse stale manual-review artifacts,
  stale approval hashes, route-shape-only evidence, or a packaged-plugin
  mount mistaken for production write-path proof.
- A manual resolution is only acceptable when the remote is preserved for
  audit and the retry path proves it re-planned from fresh evidence; the
  manual choice itself is not production proof.
- Manual resolution can only count as production-grade when the reviewed
  artifact is bound to the exact live snapshot that was approved and a stale
  approval cannot authorize a different row, file, or plugin-owned surface.
- The claim text explicitly says what is proven and what remains lab-only.
- The release notes and branch status comments never cite route shape, fixture
  smokes, or packaged-plugin mounting as production safety proof.

## Current Bottom Line

The project still has credible lab evidence for no-overwrite behavior, staged
recovery, and some guarded writes. It does not yet have the proofs needed to
promise safe production push support for arbitrary live WordPress source sites.
The honest claim remains: fixture-scoped and lab-backed push evidence, blocked
for production until the missing proofs above exist. Anything stronger is a
false reliability claim.

One more trap to keep out of the claim language: a route that returns live-looking
hashes, a packaged plugin that mounts cleanly, or a smoke that reports
`finalMatchesLocal` on a fixture is still only compatibility evidence. Those
results do not prove the write path is production-backed, do not prove remote
drift rejection, and do not prove stale approval cannot be reused after a
fresh live snapshot disagrees.

## 2026-05-24 Auth And Graph Hardening Re-Audit

Verdict: the project still must not claim production-grade push support.

The current branch improves the lab: scoped push Application Password evidence,
unprovisioned and unscoped credential rejection, signed session and nonce
cleanup, stale WordPress graph-reference blocking, stale-claim fencing, guarded
storage-boundary fixture writes, and a benchmark gate that refuses production
throughput claims when production evidence is missing. Those are real
improvements. They are still not proof that an arbitrary live WordPress source
site can be mutated safely.

The strongest honest claim remains: executable safety-model and local
Playground evidence for push invariants. The packaged `/wp-json/reprint/v1/push/*`
path still reports `routeProfile.labBacked: true`, copies Playground
implementation files into the package, and applies a graph-safe fixture slice
after dropping the unmapped graph edge. That is route-shape evidence, not
production push support.

## Evidence Reviewed

- `docs/protocol.md`
- `docs/source-notes.md`
- `docs/scenario-matrix.md`
- `docs/invariants/no-overwrite.md`
- `docs/recovery/apply-journal.md`
- `docs/executor.md`
- `docs/fast-paths.md`
- `docs/progress-log.md`
- `docs/supervisor-feedback.md`
- `audits/objective-audit.md`
- `plugins/reprint-push/reprint-push.php`
- `scripts/playground/push-remote-rest-plugin.php`
- `scripts/playground/production-shaped-route-smoke.mjs`
- `scripts/playground/production-plugin-package-smoke.mjs`
- `test/push-planner.test.js`
- `test/recovery-journal.test.js`
- `test/guarded-executor-benchmark.test.js`

## Current Claim Traps

| Trap | Scenario | Missing proof | Required change |
| --- | --- | --- | --- |
| Production-shaped routes look production-ready while still lab-backed | A site installs the temporary `reprint-push` package, sees `/wp-json/reprint/v1/push/*`, rejects unscoped credentials, applies seven graph-safe fixture mutations, and reports `finalMatchesLocal: true`. | The package still loads copied Playground internals, the preflight route reports `labBacked: true`, and the smoke deliberately removes the unmapped graph postmeta before applying. No production auth, journal, storage, graph, plugin, or remote-drift implementation is exercised. Missing proof: a live production-backed mutation path that remains safe when the remote changes between dry-run and apply. | Make production routes fail if they are lab-backed or resolve to Playground files. Keep the smoke as route-shape evidence only. |
| Graph-safe route smokes prove exclusion, not identity mapping | Local wants to push a postmeta row that references a post identity created or changed on the remote after pull. Current ready smokes delete `post_id:2001:meta_key:_reprint_push_forms_schema` from the local snapshot to avoid the blocked edge. | The planner now blocks one stale `wp_postmeta.post_id` case, but there is no automatic ID allocation, identity map, reference rewrite, or referential-integrity proof for attachments, terms, menus, users, comments, orders, serialized blocks, GUIDs, upload paths, or same-plan creates. | Treat blocked graph edges as release blockers, not as evidence to omit from ready fixtures. Add graph identity mapping or block all graph-mutating pushes that need rewriting. |
| Scoped lab credentials can be mistaken for production credential lifecycle | Packaged preflight rejects an unprovisioned alternate user and an unscoped administrator Application Password, then accepts a provisioned lab push credential. | This proves fixture metadata checks, not production lifecycle. There is no production push credential issuance, rotation, revocation, replay retention, rate limiting, TLS deployment policy, multisite scoping, or durable audit ownership. | Define production push credentials separately from the lab HMAC/Application Password fixtures and test lifecycle, cleanup, replay, and revocation under concurrent requests. |
| Signed-store cleanup is hygiene, not durability | Preflight deletes seeded expired signed-session and nonce option rows while retaining unexpired rows. | No production nonce/session store proves crash durability, cleanup races, retention windows, replay windows, option bloat limits, or auditability. | Add a production session/nonce store with retention policy, concurrency tests, and recovery behavior. |
| Manual resolution can become stale overwrite permission | An operator manually resolves a conflict, chooses "take local", or fixes a resource in wp-admin, then retries after the live remote changed again or after a partial apply left recovery evidence. | No reviewed-resolution artifact preserves base/local/remote values, the preserved remote snapshot, reviewer identity, selected action, retry scope, live snapshot timestamp, or fresh remote hashes. There is also no proof that a recovered partial apply cannot resurrect the old approval as current authority. Missing proof: the retry is rejected before any write when the remote drifts, the stale artifact remains auditable but unusable, and the next retry re-plans from a fresh live snapshot instead of reusing the old decision for a different row, file, relationship-bearing record, or plugin-owned surface. | Manual resolution is success only when the remote evidence is preserved, the user can audit and retry safely, and retry creates a new plan from a fresh live remote snapshot that cannot widen the old approval. |
| Stale manual-review artifacts can masquerade as current authority | A reviewer approved a conflict yesterday, the source drifted overnight, and a later operator note or retry reuses the old artifact as if it still applied to today’s remote. A second variant is a partial apply that leaves recovery evidence behind and then lets the next retry treat the earlier approval as still current. | There is no proof that stale approval artifacts are rejected before write, preserved with the exact reviewed snapshot, or clearly separated from partial-apply recovery records. Without that, a retry can inherit old permission on new remote data. Missing proof: the stale approval cannot authorize a different row, file, relationship-bearing record, or plugin-owned surface after drift, and a partial recovery cannot resurrect the same approval as if it were fresh. | Reject stale approvals for apply, keep them readable for audit, and force a fresh plan from fresh live evidence before retry; readability alone is audit value, not current authority. |
| Plugin allowlists can hide plugin data traps | A fixture plugin option or table row is allowed while the real plugin also depends on custom tables, serialized counters, cron rows, generated CSS, roles/caps, activation hooks, migrations, runtime-only registries, or external side effects. | Current forms and atomic-plugin paths are exact fixture allowlists. They prove conservative blocking and one hard-coded happy path, not general plugin semantics. There is no proof that remote-only ownership drift is re-evaluated immediately before apply instead of inherited from stale local metadata, or that stale manual approval cannot authorize a different plugin-owned surface after drift. | Define plugin validator/driver contracts with complete owned-resource graphs, side effects, version constraints, rollback/block behavior, and at least one real plugin proof. Unknown plugin-owned state must preserve remote and stop. |
| Coverage can be incomplete while a plan looks ready | The remote has WooCommerce HPOS tables, Action Scheduler queues, mu-plugin settings, generated files, media derivatives, multisite network tables, or plugin custom tables outside the scanner scope. | No completed coverage manifest proves every affected core, plugin, theme, upload, generated, custom-table, user/order, and multisite surface was scanned or explicitly blocked. | Make unknown or incomplete coverage a hard block. Bind completed coverage hashes into dry-run and apply evidence. |
| Fixture equality can hide hidden side effects | A smoke verifies the visible fixture surface matches local while preflight mutates auth/session option rows, plugin activation changes runtime state, or generated/cached data changes off-screen. | No side-effect manifest defines which auth stores, cron entries, generated files, object-cache state, roles/caps, plugin migration rows, or custom tables are allowed to change. | Production success must compare the planned target graph plus an explicit side-effect manifest. Any unlisted side effect blocks the claim. |
| Storage-boundary proof is still narrow | A remote edit lands after dry-run and JIT hash but before a MySQL update, insert, delete, schema change, plugin activation write, file rename, unlink, or generated-file write. | Current storage guards prove selected Playground fixture row updates and fixture upload file update/create/delete paths. They do not prove generic MySQL/InnoDB transactions, arbitrary inserts/deletes, schema writes, plugin file publish, activation side effects, locks, rollback, or target `fsync`. | Implement and test production storage guards for every supported write primitive, with race and kill tests that preserve remote state on stale writes. |
| Cross-store crash consistency is not production-proven | A plugin update publishes PHP files, changes `active_plugins`, runs migrations, updates options/custom tables, and the host dies between boundaries. | DB journal and file journal smokes are local Playground SQLite/host-mount and JSON-model evidence. They do not prove old/new/blocked classification across production DB, filesystem, activation, finalization, and replay boundaries. | Build a durable production journal and kill matrix across journal append, DB write, file write, activation, finalization, replay, stale-claim retry, and recovery inspect. |
| Stale-claim fencing remains lab/model evidence | One worker opens an apply claim, stalls, a retry advances the claim, then the old worker resumes under production load. | The all-old stale-claim smoke and JSONL stale-worker proof are deterministic lab/model paths. They do not prove production leases, fencing tokens, monotonic ownership, expiry rules, shared-DB locking, or stale-worker write prevention. | Add production lease/fencing semantics and multi-worker tests where stale workers attempt to resume after claim advancement. |
| Delete and restore policy is underspecified | The remote deleted a post for moderation, legal, editorial, or plugin reasons while local edited it; a later local push would resurrect it. Or local deletes a file while remote updates metadata for it. | The planner stops direct conflicts, but there is no tombstone model, retention window, intentional restore policy, or reviewed delete/restore evidence. | Preserve remote delete evidence, require explicit reviewed restore/delete plans, and revalidate the live remote before any resurrection or deletion. |
| Environment resources can leak or break production | A local clone contains `siteurl`, `home`, salts, SMTP/API keys, object-cache settings, cron schedules, absolute upload paths, or local-only plugin settings. | No production denylist/transform policy is proven across core and plugin resources. | Enforce deny-by-default environment-resource handling with tests for core options, secrets, paths, cron/cache/runtime data, and plugin-specific environment state. |
| Audit redaction is fixture-based | A recovery artifact includes order details, form entries, membership data, private upload paths, option payloads, API keys, or absolute paths while the operator still needs actionable recovery evidence. | Current redaction checks selected fixture strings, forbidden keys, and hash-only fields. There is no production allowlist schema, privacy review, retention policy, or operator report contract for arbitrary plugin payloads. | Define production audit schemas with stable hashes, redacted diffs, bounded retention, and useful operator-facing recovery reports. |
| Speed evidence can sound stronger than measured reliability | The guarded benchmark moves generated buffers and row payloads through the model and refuses a production throughput claim when blockers remain. | No benchmark mutates production storage with chunk cursors, retries, memory ceilings, recovery inspection, storage receipts, and safety checks enabled. | Publish speed limits only for measured production paths. Keep model and lab benchmarks labeled as non-production evidence. |
| Release tests do not match release claims | Documentation cites many passing smokes and the project sounds increasingly safe because route, auth, journal, storage, plugin, graph, and benchmark slices pass. | The strongest Playground smokes are still optional/manual and no single CI release gate runs production-shaped endpoint, auth, storage, recovery, plugin, graph, redaction, and performance evidence. | Create a release suite and CI gate. Production-grade wording must be blocked unless the full gate passes. |

## Source Comparison

The comparisons below are conservative design notes, not proof rankings. Terms
like "best baseline" or "strongest comparison point" only mean "best among the
documented ideas under the current evidence gap." They do not imply production
readiness, and they do not convert route-shape, scanner, or merge notes into
mutation safety proof. Treat the source notes as snapshots of observed
upstream state, not as current proof of upstream behavior today unless this
branch independently reverified the same revision or worktree state.
If a comparison note is used in a claim, the claim must say whether the exact
upstream revision or worktree was reverified. If it was not, the note is
historical context only and cannot support production wording.
The production release gate below is mandatory for every status note, branch
note, review comment, and release note. A lab route, package mount,
`finalMatchesLocal`, or source-note comparison can only remain compatibility
evidence until the same live write boundary is rechecked against a drifted
remote and the stale authority is rejected before mutation.

### Reprint

The Reprint source notes support staged, resumable transport: preflight,
files pull, DB pull, DB apply, flat document root, runtime apply, and
optional start. They describe pull and export mechanics, not a live
source-site mutation proof. That is a good transport primitive for push, but
it is not a mutation proof. Reprint proves that a staged workflow can be
structured, not that a remote WordPress source can survive mid-apply drift,
partial writes, or plugin-owned side effects without losing auditability.
Nothing in the route shape, package layout, or fixture replay proves live
remote preservation unless the same path also revalidates the remote and
classifies every boundary write.
A smoke that only ends in `finalMatchesLocal: true` still does not show that
the remote stayed preserved, that a fresh live snapshot was taken before the
first write, or that stale review artifacts were rejected.
Even a route name that matches production and a package mount that looks
identical to the lab can still be a copied fixture path with no live mutation
authority, so the comparison remains non-production until the live write
boundary is exercised and revalidated.
This comparison is based on the source notes in `docs/source-notes.md`, which
anchor Reprint to observed commit `27c5f25` and are historical context only.
If the current upstream revision or worktree was not independently reverified,
the comparison cannot be promoted to current proof for this repo.

What Reprint source notes do prove:

- A push transport can be staged and resumed.
- Pull/export code can carry protocol metadata, resource budgets, and streaming helpers.
- Route shape and package layout can be documented without inventing the push flow from scratch.

What they do not prove:

- Live source mutation safety.
- Remote preservation across partial apply.
- Identity stability when a live remote renumbers or reassigns objects.
- Plugin-owned side-effect safety or production credential handling.

Scenario: push applies plugin files, then the process dies before the related
options, custom-table rows, or activation state are committed. The file side is
visible, the remote state is mixed, and the operator has no proof whether the
site is old, new, or blocked.

Missing proof: the current design still lacks a production Reprint mutation
boundary with per-chunk compare-and-swap, durable recovery state across each
write surface, and an auditable rollback/blocked artifact for every remote
write boundary. Pull resumability alone does not prove source mutation safety,
and a route or packaging smoke does not prove the live source path.

Required change: production push must extend Reprint with mutation-scoped auth,
coverage-bound planning, storage-boundary guards, and a durable journal that
survives file/DB/plugin boundaries separately.

### ZS-Sync

The ZS-Sync notes are useful for scanner composition, cursors, resource
providers, and bounded changed-resource listing. They frame one site as
authoritative and the others as consumers of changed resources. They are not
a source-site mutation policy. ZS-Sync proves bounded discovery, not write
permission. Its value here is as a conservative inventory model: enumerate
what changed, then decide whether a push may proceed.

What ZS-Sync source notes do prove:

- Cursor-based, bounded rescans are feasible.
- A provider can list changed resources in batches.
- An authoritative-site model can bound discovery work.

What they do not prove:

- That a scanned resource set is complete for WordPress push.
- That discovered identity stays valid through create, aliasing, or remap.
- That unknown plugin-owned state is safe to mutate.
- That discovery alone authorizes any write.

Scenario: the scanner says the known tables and files are current, but a plugin
stores state in an unregistered custom table, a generated file, or a runtime
cache that the scanner never enumerated. The plan then looks complete while the
remote still has unscanned state that can be corrupted by the push.

Missing proof: no completed coverage manifest ties the scanner to every plugin,
mu-plugin, theme, upload derivative, generated artifact, custom table, and
multisite scope that push can affect.
That leaves room for plugin-owned state outside the scanner allowlist, such as
runtime-only registries or migration-owned rows that only appear during apply.
It also leaves room for identity remapping failures: a scan can name the right
object class and still miss that create-time IDs, aliases, or cross-table
references changed after the inventory was recorded.
Unknown plugin-owned state outside the allowlist must therefore stop the push
unless a semantic driver proves the exact ownership surface and side effects.
This comparison is based on the source notes in `docs/source-notes.md`, which
anchor ZS-Sync to observed commit `d9334a0`. Without a current upstream
reverification, it remains planning context only and cannot establish write
permission in this repo.

Required change: use ZS-Sync-style scanning as planning input only. A ready
push must block on unknown or incomplete coverage.

### ForkPress

The ForkPress notes provide the most explicit observed comparison point for
reviewed conflict handling: three-way merge records, reviewed conflict
resolution, plugin validators, revalidation, and crash consistency where
failure is old, new, or blocked with artifacts. They cover branch merge
auditability and crash consistency across WordPress files and SQLite data, not
live push of a remote source site. ForkPress is useful as a reliability
reference because it treats manual conflict handling as a first-class audited
state, but it still does not prove this repository's live remote path, graph
identity remapping, or plugin-owned state handling.

What ForkPress source notes do prove:

- Conflict resolution can be reviewed, recorded, and revalidated.
- Crash outcomes can be classified as old, new, or blocked.
- Plugin semantics can be isolated behind validators/drivers.

What they do not prove:

- That this repository has a live production push endpoint.
- That reviewed scope stays valid after remote drift.
- That manual approval can be reused after partial apply.
- That graph identity remapping is safe on create or aliasing paths.

Scenario: an operator reviews a conflict, picks "take local," and retries after
the source site changed again or after a partial apply left a mixed remote
state. If the retry accepts the old approval, the conflict review becomes
stale overwrite permission.

Missing proof: the current design does not yet show a reviewed-resolution
artifact that preserves base/local/remote evidence, binds the approval to a
fresh live snapshot, and forces the retry to rebuild the plan from current
remote hashes. It also does not show a server-side rejection path that keeps
the audit trail intact while refusing to apply the stale approval or a
recovery path that prevents old manual permission from being reused after a
partial apply.
Manual resolution also needs explicit scope fencing: a partial approval for
one object or file must not be treated as permission to apply unrelated rows,
relationships, or plugin state on retry.
Manual review is not production proof unless the remote is preserved for audit,
the reviewed scope still matches the live hashes at apply time, and the retry
path can prove it rejected stale scope before any write.
If the approval artifact cannot be tied to a fresh live snapshot, it must be
treated as stale evidence, not as permission to continue.
If a retry only proves that the manual-review UI still looks correct, but does
not prove the remote stayed preserved and the stale scope was rejected before
mutation, then the retry is not safe enough for production wording.
`finalMatchesLocal` does not change that rule; it is still only a fixture
compatibility signal, not proof of a safe retry after drift.
Manual resolution only counts when the stale artifact stays audit-only, the
remote remains preserved for later audit, and the next retry is forced to
re-plan from fresh live hashes before any mutation.

Required change: adopt the ForkPress-grade lifecycle before making
ForkPress-grade claims. Manual resolution is acceptable only when the remote
is preserved for audit, retries start from fresh evidence, and partial side
effects are classified without reusing stale manual permission or stale
approval artifacts.
This comparison is based on the source notes in `docs/source-notes.md`, which
anchor ForkPress to observed local worktree `55f9879`. Unless that upstream
state is reverified against the current code under test, it is comparison
evidence only and not current production proof.

## Must-Happen Before Production Claims

Before this project can honestly claim production-grade push support, the
design still needs proof for each of these failure classes:

- Live remote drift between dry-run and apply must fail closed before the
  first write, and the rejected state must remain auditable without being
  reusable.
- Create-time identity remapping must be proven or hard-blocked whenever a
  target can renumber, alias, or reassign under the same request path.
- Plugin-owned state outside the declared allowlist must stop the push unless
  a semantic driver proves the exact owned-resource graph and side effects for
  that plugin surface.
- Partial file, DB, or plugin side effects must be classified durably as old,
  new, or blocked, and the retry must start from fresh live evidence rather
  than inheriting stale approval.
- Manual review artifacts must stay readable for audit while becoming unusable
  for apply after drift or partial recovery.
- Comparison notes from Reprint, ZS-Sync, and ForkPress must remain
  historical context unless the exact upstream revision or worktree state was
  reverified and the same live write boundary was exercised in this repo.
  Without that reverification, a status note can sound current while still
  inheriting stale upstream assumptions about transport, scanning, or crash
  language that this repo has not proven at the mutation boundary.
  The current source notes anchor those comparisons to Reprint commit `27c5f25`,
  ZS-Sync commit `d9334a0`, and ForkPress local worktree `55f9879`; if those
  states were not reverified, the notes are context only.
- Route-shape, packaged-plugin mounting, fixture replay, and `finalMatchesLocal`
  remain lab evidence only; none of them prove live mutation safety on their
  own, even when they return plausible live-looking hashes or accept a
  production-shaped path.

## Comparison Summary

The source notes in `docs/source-notes.md` are comparison evidence only:

- Reprint proves a resumable, stage-oriented pull pipeline and a streaming
  export interface. It does not prove live source mutation safety, remote
  drift handling, rollback, or push retry semantics.
- ZS-Sync proves scanner/resource discovery and bounded batch fetching of
  changed resources. It does not prove mutation boundaries, conflict policy,
  or WordPress write safety on a live source site.
- ForkPress proves merge auditability, reviewed resolution, validator
  boundaries, and crash-consistency language. It does not prove this repo has
  a production push executor, production auth, or current upstream behavior at
  the mutation boundary.

## False Reliability Traps

These are the specific scenarios that can make the design look safer than it
is if the audit is read too loosely. Each one needs direct repo-local proof,
not route shape, package shape, or a plausible `finalMatchesLocal` result.

- A live remote drifts after dry-run, but the claim only shows the same route
  still responds with the expected path and hash. Missing proof: the stale
  approval was rejected before the first write, the exact rejected remote hash
  pair is preserved, and the remote stayed auditable for a later retry.
- A create path renumbers, aliases, or remaps identity after pull, but the
  claim treats the old mapping as stable. Missing proof: the remap was either
  proven against a fresh live snapshot or the push failed closed before any
  mutation, and the retry scope did not silently inherit the old identity.
- A plugin owns options, custom tables, generated files, cron rows, cache,
  activation hooks, or other side effects outside the allowlist, but the
  claim treats the planner's coverage as exhaustive. Missing proof: the
  surface was either discovered and validated or hard-blocked before write,
  with the rejection reason recorded for audit, and late discovery at apply
  time did not let a stale manual-review artifact or old retry scope widen to
  that new surface.
- A push leaves mixed file, DB, or plugin side effects, but the claim reports
  success because one store finished cleanly. Missing proof: the old/new/
  blocked classification is durable, the partial write is fenced or rolled
  back where possible, and the next retry starts from fresh live evidence.
- A manual-review artifact is still readable, but the live hashes changed and
  the retry reused the old approval anyway. Missing proof: the artifact is
  audit-only after drift, cannot widen scope or authorize a new target, and
  the preserved remote can still be audited without reviving the stale
  permission or treating the old approval as retry authority.
- A comparison to Reprint, ZS-Sync, or ForkPress sounds current because the
  path or package shape matches, but the upstream revision was not reverified.
  Missing proof: the cited upstream state was rechecked at the same live
  mutation boundary and the branch reproduced the rejection behavior there.
- A comparison names the exact upstream commit or worktree state, but this
  branch never reran the same live drift case here. Missing proof: branch-
  local live-boundary revalidation on the same stale-remote scenario, with the
  remote preserved for audit and the stale approval rejected before mutation.

## Production Claim Checklist

Use this checklist before any doc, PR, branch status, review comment, or
release note says `production-grade`, `production support`, or anything that
would reasonably read as equivalent.

- The write path is a real production endpoint and does not resolve to copied
  Playground, fixture, or lab internals.
- The live remote is revalidated immediately before apply, and any drift
  causes a fail-close before the first write.
- The release gate fails closed if the reviewed snapshot, coverage hash, or
  retry scope is stale, even when the route name, package name, or lab smoke
  output still looks correct.
- Every mutation surface in scope has a coverage manifest entry, or the push
  hard-blocks before apply.
- Every plugin-owned resource in scope has a declared contract, or the push
  hard-blocks before apply.
- Any plugin-owned resource outside the declared manifest is treated as unknown
  state and blocks the push; manual resolution cannot widen that scope.
- Every relationship-bearing row class has either a proven rewrite rule or an
  explicit hard block.
- Every create path has stable identity allocation, or it is blocked when the
  remote can renumber, alias, or reassign the target.
- Every create or remap path proves identity allocation before write, or it
  blocks when a remote or plugin-owned reference can change under it.
- Every create path that can renumber, alias, or reassign an identity must
  prove the remap against a fresh live snapshot before the first write.
- Every conflict resolution writes a reviewed artifact with base, local,
  remote, reviewer, action, and fresh revalidation evidence.
- Any stale manual-review artifact or stale approval hash is rejected before
  write, but still kept readable for audit and retry.
- A stale approval artifact is never treated as live permission, even when the
  route name, package name, lab smoke output, or retry status still looks
  correct.
- Stale approvals remain audit artifacts only; they cannot authorize a new
  row, file, option, or plugin-owned surface after drift.
- Manual resolution is not a success condition unless the remote remains
  preserved for audit and the retry can be replayed safely from fresh live
  evidence.
- Manual resolution is not a success condition if the remote changed after
  review, even when the old approval is still readable; the stale artifact
  must fail closed before write and the retry must start from fresh live
  evidence.
- A route-shaped smoke or package mount cannot revive a stale review artifact;
  if the fresh live snapshot does not match the reviewed scope, the artifact
  stays audit-only and cannot authorize a different row, file, option, or
  plugin-owned surface.
- Manual resolution is not production proof by itself; if the remote cannot be
  preserved for audit and the stale approval cannot be rejected in a
  retryable, user-auditable way before any write, the push must fail closed.
- A retry always starts from fresh live evidence and cannot reuse an old
  approval for unrelated rows, files, or plugin state, including plugin-owned
  surfaces that drifted after the review or were only partially approved in a
  previous attempt. Stale approval must remain readable for audit, but it
  cannot be widened into a broader write scope, replayed as current
  authority after remote drift, or treated as proof that the production
  executor is live when the route merely looks production-shaped.
- Every partial apply path is either rolled back, fenced, or preserved for
  audit and retry without a false success claim.
- A fixture replay, packaged-plugin smoke, or `finalMatchesLocal` result is
  never treated as production proof unless the same path also proves live
  remote revalidation, stale-approval rejection, and safe retry from a fresh
  snapshot with the exact approved scope.
- A production claim also requires proof that a stale approval cannot be
  replayed through the same route against a new live snapshot and accidentally
  widen into unrelated rows, files, relationship-bearing records, or
  plugin-owned surfaces; auditability alone is not enough unless the retry
  fails closed before mutation.
- `finalMatchesLocal` on its own is explicitly non-evidence for remote
  preservation, identity stability, plugin ownership safety, or crash
  recovery.
- Route-shape matches, package mounting, and fixture replay remain comparison
  evidence only; they cannot be used to claim remote preservation, identity
  stability, or plugin ownership safety without a live revalidation proof.
- Reprint, ZS-Sync, and ForkPress comparisons are design input only; they are
  never current proof that this repo has the same live executor boundary,
  stale-artifact rejection, or remote-preserving retry behavior, and they
  cannot be read as current upstream proof unless the cited upstream revision
  or worktree was reverified at the same state and at the same live mutation
  boundary.
  Their source-note provenance is limited to `docs/source-notes.md` and does
  not by itself prove any live mutation boundary in this repo.
- A route that only looks production-shaped is not evidence of production
  safety, reliability, or retry correctness, and a matching package mount does
  not prove the live executor ran.
- A copied lab route that happens to share the production pathname is still
  not production proof unless the same live write boundary was exercised on a
  drifted remote and revalidated immediately before mutation.
- A route-shaped smoke, packaged-plugin mount, or fixture replay cannot prove
  the executor is production-backed unless the proof also names the live write
  boundary, the stale remote hashes, the rejected approval, and the preserved
  remote snapshot.
- A route-shape smoke, packaged-plugin mount, or `finalMatchesLocal` result
  must never be treated as proof of live remote safety, identity stability,
  plugin-owned side-effect safety, or durable recovery.
- Route shape, package shape, `finalMatchesLocal`, or a live-looking hash
  still do not prove the live mutation executor ran, the remote was preserved,
  or stale authority failed closed before mutation.
- Comparisons to Reprint, ZS-Sync, and ForkPress remain source-note evidence
  only; they cannot be upgraded into proof of production push support without a
  repo-specific live mutation path, and they must not be treated as current
  upstream evidence unless the upstream revision was rechecked at the same
  commit or worktree state.
- If a comparison citation does not name the current upstream commit or
  worktree state, it is historical context only and cannot support production
  wording.
- A production claim must also fail closed on five specific live scenarios:
  remote drift between dry-run and apply, create-time identity remapping,
  plugin-owned state outside the declared allowlist, partial file/DB/plugin
  side effects, and stale manual-review artifacts that outlive the snapshot
  they approved.
- A manual review artifact is only acceptable when the remote snapshot,
  reviewed scope, and hashes still match at apply time; otherwise the artifact
  must stay audit-only and be rejected before any write.
- A manual-review artifact is not current authority if it omits the rejected
  scope, the retry scope, or the exact live snapshot that invalidated it; the
  missing proof makes the artifact audit context only.
- If a manual-review artifact becomes stale after drift or after a partial
  apply, the next retry must fail closed before mutation, preserve the old
  artifact for audit, and re-plan from a fresh live snapshot rather than
  widening the old approval.
- Every production journal boundary has crash evidence for old, new, or
  blocked classification.
- The release suite runs auth, storage, recovery, plugin, graph, redaction,
  and performance gates together, not as isolated smokes.
- Any production-readiness wording is blocked until the release gate passes
  with live remote revalidation, stale-approval rejection, and a fresh retry
  from the exact approved scope.
- Route-shape, fixture replay, packaged-plugin mounting, and `finalMatchesLocal`
  remain lab evidence only.
- Any production-readiness wording in docs, PRs, branch status, review
  comments, or release notes is backed by the live production path, fresh
  remote evidence, and a current reviewed artifact.
- A comparison note that only names Reprint, ZS-Sync, or ForkPress without
  the exact upstream revision or worktree and live write boundary is
  historical context only, even if the route name or package shape looks
  production-shaped.
- A stale manual-review artifact never becomes current authority just because
  the same route or package name is reused; the next retry must reject the old
  approval before write, preserve the remote for audit, and re-plan from a
  fresh live snapshot. Readability is audit value only.
- A stale manual-review artifact must fail closed on the first live-hash
  mismatch even when the same request path still returns the expected route
  shape or a fixture-level `finalMatchesLocal` result.
- A plugin-owned surface is not "covered" unless the claim names the exact
  owned resource set and shows the apply-time revalidation result; route shape,
  package mount, or fixture success alone cannot stand in for that proof.

### Release-Gate Evidence Standard

Before any wording can call this project production-grade, the claim must
carry all of these items in the same evidence set:

- The exact live write boundary that was exercised.
- The exact remote drift case, create-time remap case, plugin-owned surface
  set, and partial side-effect classification for that boundary.
- The preserved remote snapshot, the stale rejection point, and the fresh
  retry scope that kept old approval from becoming current authority.
- The exact upstream revision or worktree state for any Reprint, ZS-Sync, or
  ForkPress comparison, plus what that note actually proves.
- A fail-closed release gate result that records why any missing proof item
  blocked release.

If any of those pieces is missing, the claim stays historical context only.
Route shape, package mount, fixture replay, and `finalMatchesLocal` are not
substitutes for this evidence.

## Production Claim Blockers

Before this project can claim production-grade push support, all of the
following still need repo-local proof or an explicit hard block:

1. Live remote drift between dry-run and apply fails closed before the first
   write, and the rejected snapshot stays auditable without being reusable.
2. Create-time identity remapping either has a durable proof or is blocked
   whenever the target can renumber, alias, or reassign under the same path.
3. Plugin-owned state outside the declared allowlist is discovered and
   rejected at apply time, including custom tables, generated files, cron,
   cache, runtime registries, and other plugin side effects.
4. Partial file, DB, or plugin side effects are durably classified as old,
   new, or blocked, and a retry starts from fresh live evidence rather than
   stale approval.
5. Manual-review artifacts stay readable for audit while becoming unusable
   as retry authority after drift or partial recovery.
6. Reprint, ZS-Sync, and ForkPress comparisons remain historical unless the
   exact upstream revision or worktree was reverified at the same live
   mutation boundary.
7. Route-shape, packaged-plugin mounting, fixture replay, and
   `finalMatchesLocal` remain compatibility evidence only until the live write
   boundary, stale-authority rejection, and preserved remote are proven.

## Reliability Language Gate

Allowed wording:

- "executable safety model"
- "local Playground lab evidence"
- "fixture-scoped proof"
- "production-shaped route names backed by lab internals"
- "blocked for production until the release gates pass"

Blocked wording until the required proofs exist:

- "production-grade push"
- "production no-data-loss push"
- "production atomic plugin install/update"
- "general plugin-safe push"
- "durable production recovery"
- "safe for arbitrary live WordPress source sites"
- "production throughput"

## Release-Gate Checklist For Production Wording

Before any doc, branch note, review comment, or status update may use
production-readiness language, all of the following must be true and the
evidence must be attached or directly referenced:

1. The claim names the exact live write boundary that was exercised.
2. The claim identifies the remote drift case used, not just a lab route or
   packaged-plugin shape.
3. The claim shows the stale approval that failed closed, plus the preserved
   audit artifact that makes it readable but unusable.
4. The claim shows a fresh retry built from current live hashes rather than
   reusing the stale approval, and it names the exact reject point that kept
   the old approval from authorizing any write.
5. The claim states whether Reprint, ZS-Sync, or ForkPress source notes were
   reverified against the exact upstream revision or worktree state named in
   the claim; if not, the comparison is historical context only.
6. The claim includes the create-time identity or aliasing proof, or it says
   the create path is blocked.
7. The claim includes the plugin-owned state coverage result, including any
   unknown or out-of-allowlist surface that blocked the push.
8. The claim includes the partial file, DB, or plugin side-effect result, or
   it says that mixed writes are blocked and audited.
9. The claim names the recovery or crash artifact that preserves the old,
   new, or blocked classification.
10. The claim does not use `finalMatchesLocal`, fixture replay, route shape,
    or packaging shape as proof of production safety by themselves.
   It also does not let a route-shape smoke, packaged-plugin mount, or
   `finalMatchesLocal` result stand in for live drift rejection, stale
   approval expiry, create-time remap handling, plugin-owned allowlist
   coverage, or partial side-effect classification.
11. The claim does not treat Reprint, ZS-Sync, or ForkPress source notes as
    current upstream proof unless the exact upstream revision or worktree
    state named in the claim was reverified at the same live write boundary.
12. The claim does not use a source-note comparison to backfill any missing
    live proof for drift rejection, create remap, plugin ownership, partial
    side-effect classification, or stale approval expiry, and it does not use
    route shape or package shape to upgrade historical notes into production
    evidence.
13. The claim does not treat "manual resolution" as success unless the remote
    was preserved for audit, the stale approval was rejected before mutation,
    and the retry can be audited from fresh live hashes without widening the
    approved scope. A readable stale artifact is audit evidence only; it is
    not retry authority after drift, partial recovery, or plugin-owned state
    remapping.
14. The claim does not treat a correct upstream commit citation as current
    proof unless the branch reverified that exact upstream state at the same
    live mutation boundary. If the branch only matched route shape, package
    shape, fixture replay, or `finalMatchesLocal`, the comparison remains
    historical context only.

## Minimum Production Claim Gates

Before any production-grade push claim, the project needs all of these:

1. Production Reprint push endpoints whose implementation is not lab-backed.
2. Production-scoped auth, credential lifecycle, TLS policy, session storage,
   nonce/replay cleanup, operator identity, rate limits, and audit retention.
3. Complete pull-base and live remote coverage manifests, with unknown
   plugin/custom-table/generated resources as hard blockers.
4. Storage-boundary guarded writes for every supported DB and filesystem
   mutation kind, including inserts, deletes, schema changes, file publish,
   unlink, and activation side effects.
5. A durable production journal with kill-at-every-boundary recovery tests.
6. Reviewed conflict-resolution artifacts that preserve remote evidence and
   force fresh revalidation before retry. Stale approval artifacts must not be
   reusable after remote drift or partial recovery.
7. WordPress graph identity mapping and reference rewriting, or explicit
   blocking for graph-mutating pushes.
8. Plugin semantic driver contracts with at least one real plugin proof and a
   conservative fallback for unknown plugin state.
9. Delete/restore tombstones and reviewed resurrection policy.
10. Production environment-resource denylist/transform policy.
11. Production audit/redaction schemas with retention and operator reports.
12. A release suite and CI gate that runs safety-critical unit, Playground,
    auth, storage, recovery, plugin, graph, redaction, and performance checks.
13. Measured large-file and large-table benchmarks through the guarded
    executor path intended for release.
14. A documented release gate that fails closed on stale manual-review
    artifacts, live remote drift, identity remapping on create, unknown plugin
    ownership, plugin-owned state outside allowlists, partial file/DB/plugin
    side effects, route-shape-only evidence, fixture replay alone,
    `finalMatchesLocal` alone, any claim that only restates the lab route
    shape, any stale approval that can be reused against a new snapshot or
    widened into unrelated rows, files, relationship-bearing records, or
    plugin-owned surfaces, or any create path that can renumber, alias, or
    reassign target identity without a live remap proof. The gate must also
    require evidence that the rejected scope stayed auditable, that the remote
    was preserved for retry, and that the next attempt rebuilt its plan from
    fresh live hashes rather than inheriting the old approval. It must also
    reject any production claim that relies on Reprint, ZS-Sync, or ForkPress
    notes unless the cited upstream revision or worktree was reverified and the
    same live write boundary was exercised in this repo. A route-shape or
    packaged-plugin smoke only qualifies as release-gate evidence if the
    corresponding claim also shows the same path rejecting stale authority
    after a live remote drift, preserving the remote for audit, and forcing a
    fresh retry from current hashes. The gate must classify partial file, DB,
    or plugin side effects durably; "manual resolution later" is not success if
    the old approval can still be widened to unrelated rows, files, or
    plugin-owned surfaces.
15. A production claim must name the exact failure scenario it survived:
    live remote drift between dry-run and apply, create-time identity remap or
    aliasing, plugin-owned state outside the allowlist, partial file/DB/plugin
    side effects, or stale manual-review artifacts. If the claim cannot name
    the scenario, it does not prove the boundary and cannot count as
    production support. A stale review artifact only counts as audit evidence
    if the retry rebuilt scope from fresh live hashes and the artifact could
    not be reused against a different row, file, relationship-bearing record,
    create-time alias, or plugin-owned surface. If the artifact can still be
    used as authority after drift, the design is not production-grade, even if
    the route shape or lab smoke still looks valid.

Addendum: each of these conditions must be independently testable in the
release suite. A passing route-shape smoke is not sufficient if any one of the
following still lacks proof:

- live remote drift detected only after a write starts;
- create-time remap or aliasing that changes the target identity;
- plugin-owned state outside the allowlist that remains writable;
- partial file, DB, or plugin side effects that cannot be fenced or audited;
- stale manual-review artifacts that can be replayed as current authority.

If a claim says "manual resolution," it must also show the preserved remote,
the stale artifact rejection, and the fresh-hash retry; otherwise the phrase
is only a label for an unresolved conflict.

Source-note comparison rule: Reprint, ZS-Sync, and ForkPress remain
comparison inputs only. Their notes can support a design discussion, but they
do not prove production push support unless the exact upstream revision or
worktree was reverified and the same live write boundary was exercised in this
repo. If the claim omits that revalidation, the comparison stays historical
context and cannot fill any gap in drift rejection, create remap handling,
plugin-owned allowlist coverage, or partial side-effect classification.
Do not let a correct upstream commit citation read as present-tense proof by
itself; without a branch-local recheck at the same live mutation boundary, the
citation is still only historical context.
Treat any comparison citation as frozen evidence until the cited upstream
state is reverified at the same live mutation boundary; a matching route shape
or package layout does not upgrade the citation into proof, and a stale manual
review artifact does not become current authority just because the upstream
note sounds conservative. The same applies to `finalMatchesLocal`: it can
confirm a lab route answer, but it cannot prove the live executor, preserved
remote, or stale-authority rejection needed for production wording.

The release gate is not satisfied by "looks production-shaped" evidence. A
route that mounts in the right package, returns live-looking hashes, or passes
fixture replay still needs a live remote revalidation proof at the actual write
boundary, plus stale-approval rejection and auditable retry behavior under drift.
- Stale approvals must remain readable for audit while being unusable for
  apply; reusing the old approval as current authority is a release failure.
- Any live remote drift between dry-run and apply must fail closed before the
  first write, and the rejection must cite the exact live hashes that failed
  validation.
- Any create-time remap, alias, or renumber event must either have a proven
  identity reservation or hard-block the push before mutation.
- Any plugin-owned state that is outside the declared allowlist, including
  custom tables, generated assets, runtime registries, cron-backed rows, or
  external side effects, must hard-block the push unless a plugin-specific
  validator proves safe handling for that exact surface.
- Any plugin-owned surface outside the allowlist must block the push, even if
  a route-shape smoke or packaged-plugin mount still looks correct.
- Any mixed DB/filesystem/plugin side effect path must have durable
  old/new/blocked evidence; a single-store success path does not satisfy the
  gate.
- Route-shape-only evidence, fixture replay alone, and `finalMatchesLocal`
  alone are never enough to claim production support.
- A comparison note from Reprint, ZS-Sync, or ForkPress is never enough on
  its own; if the upstream revision or worktree was not reverified, the note
  is historical context only and cannot support production wording.
- A route that only proves endpoint shape, packaged-plugin mounting, or
  copied-lab route wiring must fail the release gate unless the same live
  remote mutation path was reproduced with a drifted remote, the stale
  approval was rejected before any write, and the preserved remote snapshot
  can still be audited and retried safely. If the evidence set does not show
  the exact live request path and storage boundary, the route remains
  compatibility evidence only. A route can look production-shaped while still
  executing copied-lab internals behind the mount, so a green hash there is
  never production proof by itself.
- The release claim must name the exact request path, auth mode, and storage
  boundary used for that drifted-remote proof; matching route shape or
  package layout alone is compatibility evidence, not production proof.
- A mounted route that returns live-looking hashes still has to prove how
  partial file, DB, or plugin side effects are classified and retried; the
  hash alone never proves the write executor, the plugin-owned boundary, or
  that the route is anything more than a fixture-backed stand-in.
- A production claim must name the exact failure scenario it survived:
  live remote drift between dry-run and apply, create-time identity remap or
  aliasing, plugin-owned state outside the allowlist, partial file/DB/plugin
  side effects, or stale manual-review artifacts. If the claim cannot name
  the scenario, it does not prove the boundary and cannot count as
  production support.
- Manual resolution is not a success state unless the remote is preserved for
  audit, the stale artifact is rejected before write, and the retry starts
  from fresh live evidence with no scope widening.
- A stale manual-review artifact remains readable for audit but must become
  unusable as authority as soon as the live hashes change; readability alone
  is not a success condition, and the retry must rebuild scope from fresh
  live evidence rather than inheriting the old approval.
- If an operator can still “approve” a stale artifact after drift without a
  fresh live snapshot, the design is not production-grade: the missing proof is
  rejection-before-write plus a preserved remote that the reviewer can audit
  and retry from, not a second manual click.
- Reprint, ZS-Sync, and ForkPress notes are comparison evidence only; they do
  not prove current upstream behavior today, and they do not prove this repo's
  live mutation boundary unless the same upstream revision or worktree was
  independently reverified.
- A claim that cites those notes must say whether the upstream revision or
  worktree was reverified. If it was not, the note is historical context only
  and cannot support production wording. A matching route path, package mount,
  or live-looking hash does not upgrade that status.
- Any unverified Reprint, ZS-Sync, or ForkPress note remains historical
  context even if the route name, package mount, or expected hash looks
  production-shaped; it is not current upstream proof without the exact live
  mutation boundary being rechecked.
- See `audits/source-notes-comparison.md` for a conservative breakdown of
  what each note proves and what it does not prove.
- Status comments, branch notes, and release notes must not cite source-note
  comparisons or live-looking hashes as substitutes for current production
  proof.
- A production claim must also show the create-time identity decision,
  plugin-owned allowlist decision, and partial side-effect classification for
  the exercised write path; omitting any of those leaves a data-loss hole even
  if the route shape and `finalMatchesLocal` look correct.

### Non-Negotiable Proofs

Do not let any production-grade wording through unless the claim can show all
of the following in the same evidence set:

- The live remote drift happened between dry-run and apply.
- The stale approval was rejected before mutation and remained readable for
  audit only.
- The rejected approval cannot be reused as retry authority for the same row,
  a different row, a file, a relationship-bearing record, or a plugin-owned
  surface after drift.
- The retry started from fresh live hashes and a fresh scope decision.
- The create-time identity case either had a durable remap proof or was
  hard-blocked before write.
- The plugin-owned surface list is complete for the claim, or unknown surfaces
  are hard-blocked.
- The partial file, DB, or plugin side effect class is classified durably and
  cannot silently inherit the old approval.
- Any Reprint, ZS-Sync, or ForkPress comparison is marked historical unless
  the exact upstream revision or worktree was reverified at the same live
  mutation boundary.
- A route-shape smoke, fixture replay, or `finalMatchesLocal` result is not
  enough to upgrade a historical source-note comparison into current proof;
  the claim still needs the live write boundary, stale-authority rejection,
  and preserved remote evidence for the current repository state.
- The claim does not say "manual resolution succeeded" unless the preserved
  remote can still be audited, the stale artifact was rejected before write,
  and the retry rebuilt scope from fresh live hashes instead of reusing the
  old approval, even if the artifact stayed readable and the route or
  package mount still looks production-shaped.
- The claim does not say a manual-review artifact is still current authority
  after drift. If the artifact is only readable, the missing proof is a
  rejected-before-write boundary that preserves the remote and prevents the
  same artifact from authorizing a different row, file, relationship-bearing
  record, or plugin-owned surface on retry.

Until then, the project is a strong lab for the right invariants, not
production-grade source-site push support.

Evidence boundary addendum: if a future claim cannot name the exact live
request path, the exact stale-approval rejection, the exact preserved remote
snapshot, and the exact reverified upstream revision or worktree state, it is
still only comparison context or compatibility evidence. A route-shaped smoke
or package mount can look production-shaped without proving the production
executor, the remote-preserving retry path, or the audit-only status of the
rejected approval after drift.

This is the production cutoff, not a suggestion. Before any production-grade
push wording is allowed, the repo must show or block all of the following in
the same evidence set: live remote drift rejection before mutation, create-
time remap or alias handling, plugin-owned state outside the allowlist,
partial file/DB/plugin side effects, and stale manual-review artifacts that
remain readable for audit but unusable as retry authority. A route-shape
smoke, fixture replay, or `finalMatchesLocal` result cannot backfill those
gaps, and a comparison to Reprint, ZS-Sync, or ForkPress is historical only
unless the cited upstream revision or worktree was reverified at the same live
write boundary.

Concrete failure scenarios that still need repo-local proof:

- A remote row changes after dry-run but before the first write. The missing
  proof is a live revalidation check that fails closed before any mutation and
  preserves the rejected hashes for later audit.
- A create path renumbers or aliases the target ID during apply. The missing
  proof is either a durable remap reservation or a hard block before write,
  plus an audit trail that names the exact live identity that was reserved,
  aliased, or rejected.
- A plugin owns custom tables, serialized state, cron rows, generated files,
  or runtime registries outside the allowlist. The missing proof is an exact
  owned-surface manifest and apply-time revalidation, or a durable block with
  an auditable rejection reason that cannot be promoted into current authority
  later.
- A write succeeds in one store but not another, leaving mixed DB/file/plugin
  state. The missing proof is durable old/new/blocked classification and a
  retry path that starts from fresh live evidence instead of inherited
  approval.
- A manual-review artifact is still readable after drift. The missing proof is
  that the artifact remains audit-only, cannot widen scope, and cannot be used
  as current authority on retry.
- A manual-review artifact can still be read after drift but is reused for a
  different row, file, relationship-bearing record, or plugin-owned surface.
  The missing proof is rejection before mutation, a preserved remote for
  audit, and a retry that rebuilds scope from fresh live hashes instead of
  inheriting the old approval.
- A comparison note from Reprint, ZS-Sync, or ForkPress is treated as current
  because the route shape looks similar. The missing proof is the exact
  upstream revision or worktree state, plus a recheck at the same live write
  boundary that rejected stale authority before mutation.
- A Reprint, ZS-Sync, or ForkPress comparison sounds current because the route
  or package shape matches. The missing proof is the exact upstream revision or
  worktree state and a fresh recheck at the same live write boundary.
- Route-shape smokes, packaged-plugin mounts, fixture replay, and
  `finalMatchesLocal` are not reliability proof on their own, because they do
  not show the live write boundary preserving the remote under drift. They
  also do not rule out a copied-lab executor behind a production-shaped mount,
  which means any live-looking hash from that path is still compatibility
  evidence only.

Production-readiness release gate for wording:

- Name the exact live drift scenario the claim survived, not just the route or
  package shape.
- Show that stale authority was rejected before mutation and stayed readable
  only as audit evidence.
- Show that the retry rebuilt scope from fresh live hashes and did not inherit
  the old approval.
- Show the create-time identity decision, including any alias, renumber, or
  remap case, or show the hard block that prevented mutation.
- Show the complete plugin-owned surface list for the claim, and hard-block
  anything outside it.
- Show durable classification for partial file, DB, or plugin side effects, or
  do not use production wording.
- Show that any manual-review artifact cannot widen scope to a different row,
  file, relationship-bearing record, or plugin-owned surface after drift.
- Show that any comparison note from Reprint, ZS-Sync, or ForkPress was
  reverified at the same live mutation boundary, and name the exact upstream
  commit or worktree state that was reverified; otherwise treat it as
  historical context only.
- Show the exact upstream revision or worktree that was reverified, or the
  comparison stays historical even if the route name, package shape, or
  fixture replay looks production-shaped.
- Treat route-shape smokes, packaged-plugin mounts, fixture replay, and
  `finalMatchesLocal` results as compatibility evidence only unless the same
  evidence set also includes live remote revalidation and preserved remote
  audit data.
- Treat "manual resolution" as a failed production proof unless the remote is
  preserved for audit, the stale approval is rejected on retry, and the retry
  can be independently audited from fresh live hashes.
- Treat a stale manual-review artifact as audit-only unless the claim shows
  the rejection-before-write path, the preserved remote, and the fresh retry
  scope; otherwise the artifact is current authority by mistake.

Source-note comparison scoreboard:

- Reprint: useful for staged delivery rhythm and resumable work, but not
  proof of a live source overwrite boundary, stale remote rejection, or
  preserved-remote retry on this repo's write path.
- ZS-Sync: useful for bounded scanning and change detection, but not proof of
  create-time identity remapping, plugin-owned allowlist coverage, or
  partial-side-effect classification at apply time.
- ForkPress: useful for review vocabulary around merge and recovery, but not
  proof that this repo's live mutation executor preserves the remote, blocks
  stale authority, or keeps manual-review artifacts audit-only after drift.

Current-proof boundary for comparisons:

- A correct upstream commit id is provenance only. It does not become
  current proof unless this branch also rechecked the same live mutation
  boundary here and recorded the preserved remote, stale rejection point, and
  fresh retry scope.
- A matching route shape, package mount, or `finalMatchesLocal` hash is
  compatibility evidence only. It does not prove the live executor, create-
  time identity decision, plugin-owned surface coverage, or partial side-
  effect classification.
- A stale manual-review artifact stays audit-only even when it is readable.
  It cannot authorize a retry against a late-discovered plugin-owned surface,
  a remapped create target, or any other row, file, relationship-bearing
  record, or side effect that was not already classified on the first pass.
- If a source-note comparison lacks the exact upstream revision or worktree
  state, the exact live write boundary, or the branch-local same-boundary
  recheck, the comparison must remain historical context only.

Production-grade push wording is still blocked unless the current evidence set
proves all of the following in the same live write boundary:

- a drifted remote was revalidated before the first write and stale authority
  failed closed;
- create-time identity remapping either had a durable remap proof or was
  blocked before mutation;
- plugin-owned state outside the allowlist was enumerated or hard-blocked,
  including custom tables, generated files, cron rows, runtime registries, and
  other late-discovered side effects;
- mixed file, DB, or plugin side effects were durably classified as old, new,
  or blocked instead of being treated as success by a single-store pass;
- any manual-review artifact stayed auditable after drift but could not be
  reused as retry authority or widened to a different row, file,
  relationship-bearing record, or plugin-owned surface;
- the claim names whether Reprint, ZS-Sync, or ForkPress source notes were
  reverified at the cited upstream revision or worktree, and treats them as
  historical comparison only if that recheck did not happen at the same live
  mutation boundary;
- route shape, package shape, fixture replay, and `finalMatchesLocal` are
  treated as compatibility evidence only, not proof of the live executor.
- any readable manual-review artifact is explicitly audit-only, and the proof
  shows the remote stayed preserved while a fresh retry rebuilt scope from new
  live evidence instead of inheriting the old approval.

If any of those notes are cited in production-readiness language, the claim
must also name the exact upstream revision or worktree state that was
reverified at the same live mutation boundary. Otherwise the comparison is
historical context only.

Do not accept these claims as production wording unless the same live write
boundary, preserved remote, stale rejection, and fresh retry scope are all
present in the proof:

- "The route is production-safe" when the only evidence is route shape,
  packaged mount shape, or `finalMatchesLocal`.
- "Manual resolution succeeded" when the remote was not preserved for audit,
  the stale artifact could still authorize a retry, or the retry scope was not
  rebuilt from fresh live hashes.
- "The plugin is handled" when the proof only covers the main row and not the
  plugin-owned allowlist, custom tables, generated files, activation hooks,
  cron rows, cache entries, runtime registries, or other side effects.
- "The comparison proves it" when the Reprint, ZS-Sync, or ForkPress note was
  not reverified against the exact upstream revision or worktree state at the
  same live mutation boundary, even if the route name, package mount, or hash
  looks current.
- "Recovery succeeded" when one store committed and the rest were only
  classified, because mixed file, DB, or plugin writes still need durable
  old/new/blocked evidence and a retry that starts from fresh live evidence.

Production-readiness checklist:

- Show a live remote drift case that fails closed before the first write.
- Show a create-time remap, alias, or renumber case that is either reserved
  durably or blocked before mutation, with the live remote identity decision
  named explicitly rather than inferred from a stable local ID.
- Show the full plugin-owned surface manifest for the exercised claim, and
  hard-block every unknown or out-of-allowlist surface.
- Show durable handling for mixed file, DB, or plugin side effects, including
  audit evidence for what was written, what was blocked, and what can be
  retried safely.
- Show a preserved remote snapshot that can be audited later without letting
  the stale approval become current retry authority, and without letting a
  readable manual-review artifact widen to a different row, file, relation, or
  plugin-owned surface after drift.
- Show explicit rejection of stale manual-review artifacts before write, and
  prove those artifacts stay audit-only rather than becoming retry authority
  after the remote changes again. The proof must name the preserved remote
  snapshot, the stale rejection point, and the fresh retry scope in the same
  claim block; otherwise the artifact is only inspection evidence, not retry
  authority.
- Show the exact upstream revision or worktree state for any Reprint, ZS-Sync,
  or ForkPress comparison, and name what that note actually proves. Reprint
  only supports staged transport and resumability, ZS-Sync only supports
  bounded discovery, and ForkPress only supports reviewed-resolution and
  crash-consistency vocabulary. If the same claim block does not also name the
  live mutation boundary in this repo, the preserved remote, and the stale
  rejection point, the comparison remains historical context only.
- Show that route-shape smokes, packaged-plugin mounts, fixture replay, and
  `finalMatchesLocal` are only compatibility evidence unless the same live
  write boundary is reverified against a drifted remote in this repo and the
  proof names the preserved remote, stale rejection point, and fresh retry
  scope.
- Show that any Reprint, ZS-Sync, or ForkPress comparison was reverified at
  the cited upstream revision or worktree, at the same live mutation
  boundary, on the same live mutation executor, and with the exact preserved
  remote and stale-authority rejection case; otherwise the note remains
  historical context only and cannot support any production wording.
- Show a release gate that fails closed when any of the above is missing and
  that records the exact rejection reason for audit and retry. A gate that
  only logs "manual resolution" or "comparison passed" without the preserved
  remote, stale-artifact rejection point, fresh retry scope, and exact live
  write boundary is not a release gate.

False reliability claims to avoid:

- "The route is production-grade" when the proof only covers a lab route,
  packaged mount, or `finalMatchesLocal` hash.
- "The compare note proves it" when the Reprint, ZS-Sync, or ForkPress
  source note was not reverified against the exact upstream revision or
  worktree state at the live write boundary, or when it only describes a
  historical upstream shape without the same live mutation executor.
- "The route or hash proves it" when the evidence only shows route shape,
  package shape, a copied-lab mount, or `finalMatchesLocal` without the live
  drift rejection boundary and preserved remote proof.
- "Manual resolution succeeded" when the remote was not preserved for audit,
  the stale approval stayed reusable, or the retry was not rebuilt from fresh
  live evidence.
- "Release gate passed" when the evidence set omits any blocker above but
  still emits a lab-shaped success marker. Production wording requires the
  exact rejection reason for every missing proof item.
- "Readable artifact means retry authority" when the claim does not name the
  preserved remote snapshot, the stale rejection point, and the fresh retry
  scope together. Readability alone is inspection evidence, not authority.
- "Comparison passed" when a Reprint, ZS-Sync, or ForkPress note is cited
  without the exact upstream revision or worktree state and the exact live
  mutation boundary that was reverified for this repo's claim.
- "The plugin is safe" when the proof omits plugin-owned state outside the
  allowlist, including generated files, cron rows, runtime registries, custom
  tables, or other late-discovered side effects.
- "One plugin row was enough" when late-discovered plugin-owned surfaces could
  still appear under the same plugin prefix, option family, or file tree.
- "Recovery succeeded" when the apply left mixed file, DB, or plugin state
  but the failure was not durably classified as partial with a fresh retry
  scope.
- "Current proof" when a comparison note names Reprint, ZS-Sync, or ForkPress
  but does not also name the exact upstream revision or worktree state, the
  exact live mutation boundary, the preserved remote, the stale rejection
  point, and the fresh retry scope rebuilt from that preserved remote.

Additional production-readiness blockers that still need explicit proof:

- Hidden data-loss modes must be named and closed, including a dry-run/apply
  drift where the live remote changes before the first write, a create-time
  identity remap or alias that points at a different live target, plugin-owned
  state outside the allowlist, partial file/DB/plugin writes, and stale review
  artifacts that remain readable after drift.
- Ambiguous conflict policy must be removed. Every manual-resolution path must
  say whether the remote was preserved, whether the stale artifact was rejected
  as authority before mutation, and what fresh live evidence rebuilt the retry
  scope from the preserved remote. "Manual resolution" is not a success label
  unless the remote stayed auditable and the retry was rebuilt from fresh live
  hashes.
- Plugin data traps must be proven safe or blocked with an explicit surface
  list. A single allowlisted option, row, generated file, cache entry, cron
  row, runtime registry, serialized blob, or plugin route does not prove the
  rest of the plugin-owned graph is safe.
- False reliability claims must be barred from release wording, including any
  statement that route shape, package mount, fixture replay, or
  `finalMatchesLocal` proves production safety; those are compatibility checks
  only and never evidence that the live mutation executor failed closed on a
  drifted remote.
- Any comparison to Reprint, ZS-Sync, or ForkPress must stay conservative:
  it may describe design context, but it does not become current proof unless
  the exact upstream revision or worktree state and the exact live mutation
  boundary were both reverified for this repo's claim on the same live
  mutation executor. If either one is missing, the comparison is historical
  context only.
- Any comparison that lacks those two specifics is historical context only,
  even if the route shape, mount shape, or hash output looks current. A
  matching hash or mount tells us the lab shape is compatible; it does not
  prove the live executor, stale rejection point, or preserved remote.
- A claim that only says the upstream citation is "correct" is still not
  production proof unless it also shows the branch-local recheck at the same
  live boundary. A correct citation without a same-boundary recheck is just a
  better historical reference, not current evidence.
- Production-ready wording also needs a release gate that fails closed on the
  following concrete cases:
  - live remote drift that appears after dry-run but before the first write;
  - create-time remap or aliasing that changes the identity boundary;
  - plugin-owned state outside the allowlist, including runtime registries,
    generated surfaces, cron rows, caches, or serialized blobs;
  - partial file/DB/plugin side effects that cannot be classified durably as
    old, new, or blocked;
  - stale manual-review artifacts that still look readable after drift.
- A release gate that only checks lab route shape, fixture replay, or
  `finalMatchesLocal` is not a production gate. It must show the preserved
  remote, the stale rejection point, and the fresh retry scope for each failed
  case above, plus the exact plugin-owned surfaces that were discovered or
  hard-blocked. If the gate cannot name the exact failure scenario it survived,
  it is not a production gate.
- A readable stale manual-review artifact is not enough on its own. The gate
  must show that the artifact stayed audit-only after drift, that the remote
  was preserved for audit, and that the retry was recorded as a fresh artifact
  rebuilt from current live hashes rather than inherited approval. If no fresh
  retry artifact exists, the wording remains blocked even if the stale note is
  still readable.

Before this project can claim production-grade push support, it still needs
these explicit proofs:

1. Live remote drift between dry-run and apply fails closed on the real write
   path, not just on a lab route, and the preserved remote remains auditable.
2. Create-time identity remap or aliasing is either durably proven safe or
   hard-blocked before mutation, including rename and renumber cases.
3. Plugin-owned state outside the allowlist is enumerated or blocked at apply
   time, including late-discovered custom tables, generated files, cron rows,
   caches, runtime registries, serialized blobs, and external side effects.
4. Partial file, DB, or plugin side effects are durably classified as old,
   new, or blocked, and retry must rebuild scope from fresh live hashes rather
   than reusing stale approval.
5. A stale manual-review artifact remains audit-only after drift and cannot
   widen into a different row, file, relationship-bearing record, or
   plugin-owned surface, even if the artifact is still readable or attached
   to a production-shaped route.
6. Any Reprint, ZS-Sync, or ForkPress comparison names the exact upstream
   commit or worktree state and is reverified at the same live mutation
   boundary; otherwise it is historical context only.
7. A source-note comparison never becomes current proof from route shape,
   package shape, or `finalMatchesLocal`; it must also name the exact live
   write boundary and the stale-remote case that was reverified on this
   branch.
8. Any manual-resolution claim must prove the remote stayed preserved for
   audit, the stale artifact was rejected before mutation, and the retry scope
   was rebuilt from fresh live evidence rather than inherited from the old
   review token.
9. A readable manual-review artifact that still matches the same row, path,
   or route family after drift is still audit-only unless this branch also
   shows the preserved remote, reject point, and fresh retry artifact for
   that exact live boundary.

The release gate is intentionally strict because the unsafe failures are not
theoretical. A route can return current-looking hashes while still hiding a
different live target behind a create-time remap, a plugin can write a cron row
or runtime registry entry that the main row audit never mentions, and a
readable review artifact can keep looking legitimate after drift while no
longer being safe authority. If the branch cannot prove which of those failure
modes it survived, the claim stays lab-backed.

Production-readiness wording stays blocked unless all of the above are true
on the same live write path. If the evidence only shows a production-shaped
route, a packaged mount, a fixture replay, or a matching `finalMatchesLocal`
hash, the claim is still lab-backed. If the evidence only shows a readable
manual-review artifact or a source-note comparison, the claim is still
historical context. If the evidence does not preserve the remote for audit
after reject, it is not a production-ready push claim.

Hard failure modes that still disqualify production wording:

- A route-shaped smoke or packaged-plugin mount that never exercised a live
  drifted remote on this branch.
- A readable stale review artifact that can still be copied, matched, or
  reused as authority after drift, even if it remains inspectable for audit.
- A create-time alias or identity remap that silently hits a different live
  target than the local row or path the claim names.
- A plugin-owned surface discovered after the first write, including custom
  tables, generated files, cron rows, runtime registries, caches, serialized
  blobs, or external side effects, when the proof only covered the first pass.
- A partial file, DB, or plugin write that is relabeled as success without a
  durable old/new/blocked classification and a separately recorded fresh
  retry scope.
- A Reprint, ZS-Sync, or ForkPress comparison that names the upstream state
  but not the branch-local live boundary where stale authority was rejected.

Source-note comparison summary:

- Reprint proves staged transport and resumable delivery rhythm. It does not
  prove a live source overwrite boundary, stale remote rejection, or partial
  side-effect classification here.
- ZS-Sync proves bounded discovery and change scanning. It does not prove
  create-time identity remapping, plugin-owned allowlist coverage, or live
  apply-time write safety here.
- ForkPress proves merge review vocabulary and crash-consistency intent. It
  does not prove that stale review artifacts stay audit-only after drift or
  that the remote is preserved for audit on reject.
- None of the three become current proof unless this branch also shows the
  exact live mutation boundary, the preserved remote, the stale rejection
  point, the fresh retry scope, and the branch-local recheck of the same
  drifted-remote case on the same path.

Production-readiness release gate checklist:

1. Name the exact live request path, live write boundary, and drifted remote
   case that failed closed before the first write.
2. Show the preserved remote snapshot, the stale rejection point, and the
   fresh retry scope rebuilt from current live hashes.
3. Show that a readable manual-review artifact stayed audit-only and could
   not widen into a different row, file, relationship-bearing record, or
   plugin-owned surface on retry.
4. Show the create-time identity decision, including any alias, renumber, or
   remap outcome, or show the hard block that prevented mutation.
5. Enumerate the full plugin-owned surface list for the claim, and hard-block
   any unknown or out-of-allowlist surface, including custom tables,
   generated files, cron rows, runtime registries, serialized blobs, and
   external side effects.
6. Classify any partial file, DB, or plugin side effect durably as old, new,
   or blocked, and prove the next retry rebuilt scope from fresh live hashes
   rather than inheriting stale approval.
7. Treat Reprint, ZS-Sync, and ForkPress notes as historical context unless
   the exact upstream commit or worktree state was reverified at the same
   live mutation boundary for this repo's claim and the branch-local retry
   or drift case was rerun here. A matching feature name, route family, or
   package layout never upgrades the note into current proof.
8. Fail closed if the wording only cites route shape, packaged-plugin mount,
   fixture replay, or `finalMatchesLocal` without the live boundary proof
   above. A readable manual-review artifact is not enough unless the claim
   also shows the preserved remote, the stale rejection point, the fresh
   retry scope, and the fresh retry artifact on the same live write path.
9. Explicitly treat any lab-shaped or fixture-shaped route, mount, or replay
   as compatibility evidence only; do not let a production-shaped URL family
   or package layout imply the live executor, auth path, or write boundary
   was production-safe without the same-boundary drift recheck here.

The branch still has four production-grade blocker classes to close:

- Hidden data-loss modes: live drift, partial file/DB/plugin side effects, or
  a late-discovered plugin-owned surface can still be widened into a false
  success unless the proof shows the remote stayed preserved and the retry
  started from fresh live hashes.
- Ambiguous conflict policy: every touched row, file, relationship-bearing
  record, and plugin-owned surface still needs an explicit old, new, or
  blocked classification before retry starts.
- Plugin data traps: fixture-shaped allowlist coverage still does not prove
  custom tables, generated files, cron rows, runtime registries, serialized
  blobs, or other plugin-owned side effects are discovered and handled.
- False reliability claims: route shape, packaged mounts, fixture replay,
  `finalMatchesLocal`, and a readable manual-review artifact remain
  compatibility or audit evidence only until the preserved remote and fresh
  retry artifact are recorded separately on the same live boundary.

If any of those proofs is missing, the claim is not production-grade. The
specific failure cases that still need explicit proof are:

- Live remote drift after dry-run but before the first write, because a
  matching route path does not prove the stale remote was revalidated on the
  real executor.
- Create-time identity remap or aliasing that points at a different live
  target, because a stable local ID does not prove the write hit the intended
  record.
- Plugin-owned data outside the allowlist, because one covered row does not
  prove the rest of the plugin-owned graph is safe.
- Partial file, DB, or plugin side effects, because a single committed store
  does not prove mixed writes were classified or retried safely.
- Stale manual-review artifacts, because a readable artifact does not prove it
  stayed audit-only after drift or that it could not widen scope on retry.
- Reprint, ZS-Sync, or ForkPress source notes, because historical comparison
  does not prove the exact live boundary on this branch unless the cited
  upstream revision or worktree state was rechecked there.
- A comparison note that names the upstream state but not the branch-local
  live retry is still historical context, not current proof, even if the route
  shape and hash values look production-shaped. The missing proof is the
  branch-local same-boundary rerun, not a more confident interpretation of
  the note.

Minimum proof artifacts before any production-grade push wording:

1. A live-boundary trace that names the exact request path, the exact stale
   remote hash set, and the exact rejection point before mutation.
2. A preserved-remote audit trail that stays readable after drift but cannot
   authorize retry, widen scope, or stand in for fresh live hashes.
3. A fresh retry artifact that is recorded separately from the stale review
   artifact and rebuilt from current live evidence, not inherited approval.
4. A create-time identity decision that is either a durable remap proof or a
   hard block before write, including any rename, alias, or renumber case.
5. A complete plugin-owned surface inventory for the claim, with unknown or
   late-discovered surfaces hard-blocked at apply time.
6. A durable old/new/blocked classification for every touched file, DB, or
   plugin side effect, so partial writes cannot be relabeled as success.
7. A source-note comparison record that names the exact upstream revision or
   worktree state, says whether it was reverified at the same live write
   boundary, and records the branch-local same-boundary recheck; otherwise
   the comparison remains historical context only.
8. A release claim that avoids "manual resolution later" unless the remote was
   preserved for audit, the stale artifact was rejected before mutation, and
   the fresh retry artifact was recorded separately from the stale review
   artifact.
9. A later-discovered plugin-owned surface is not rolled into the earlier
   success claim; it has its own rejection point, preserved remote, and fresh
   retry scope, or the write boundary is still unproven.

False reliability claims to avoid:

- "Manual resolution succeeded" when the remote was not preserved for audit,
  the stale artifact was not rejected before mutation, or the retry was not
  rebuilt from fresh live evidence.
- "The comparison proves it" when the Reprint, ZS-Sync, or ForkPress note did
  not cite the exact upstream revision or worktree state, was not rechecked
  at the same live write boundary, or lacks the branch-local same-boundary
  recheck. A matching upstream state without a fresh branch-local live
  boundary rerun is still historical context, not current authority.
- "The plugin is handled" when the claim only covers the main row and not the
  complete plugin-owned surface list, including late-discovered side effects.
- "Recovery succeeded" when only one store committed and the others were
  merely observed, because mixed side effects still need durable old/new/blocked
  classification.
- "The artifact still looks valid, so retry can proceed" when the readable
  manual-review note or source-note comparison is only audit context. If the
  remote drifted, that artifact stays audit-only and cannot authorize a retry
  against any different row, file, relationship-bearing record, or
  plugin-owned surface, including a late-discovered cache entry, cron row,
  runtime registry, generated file, or custom table.
- "Manual resolution later" when the only new evidence is a still-readable
  stale review note. Readability is audit value only unless the claim also
  shows the preserved remote, the stale rejection point, and a separately
  recorded fresh retry artifact rebuilt from current live hashes. A readable
  stale review note is not retry authority for any late-discovered
  plugin-owned surface, including a cache entry, cron row, runtime registry,
  generated file, custom table, or other hidden side effect that was not
  classified on the first pass, and it is not a production-safe success
  label unless the remote remained auditable after reject.
- "Manual resolution later" is also not a safe label when the proof only
  shows the stale note could still be opened, copied, or matched against a
  route-shaped replay. The missing proof is the live reject-before-write
  boundary on this branch, plus a preserved remote and a fresh retry record
  that did not inherit the stale note as authority.
- "The route is production-safe" when the evidence only shows route shape,
  a packaged mount, a fixture replay, or `finalMatchesLocal`. Those are
  compatibility checks, not proof that the live executor rejected stale
  authority before mutation.

Production claim bar:

Do not call the design production-grade push support unless the claim names
all of these in the same branch-local proof:

- the exact live write path that failed closed after drift, before mutation;
- the preserved remote snapshot that remained auditable after reject;
- the fresh retry artifact that was recorded separately from the stale review
  artifact;
- the create-time identity decision, including any rename, alias, or renumber
  case, or the hard block that prevented mutation;
- the full plugin-owned surface inventory for the exercised claim, with
  anything unknown or outside the allowlist hard-blocked at apply time; and
- the durable old/new/blocked classification for every touched file, DB, or
  plugin side effect.
- the exact upstream revision or worktree state for any Reprint, ZS-Sync, or
  ForkPress comparison, plus the branch-local live drift or retry case that
  was reverified here.

If any one of those is missing, the claim is still lab-backed or historical
context, even if the route shape, packaged mount, fixture replay, or
`finalMatchesLocal` hash looks production-shaped. In particular, "manual
resolution later" is not a success label when the first write already
committed on a narrower surface and a late-discovered plugin-owned surface
still needs work. That scenario only counts if the preserved remote is still
auditable, the late surface is blocked or durably classified before any
retry, the stale artifact cannot authorize retry for any other row, file,
relationship-bearing record, or plugin-owned surface, and the fresh retry
artifact is recorded separately from the stale review artifact. If a second
write touches that late-discovered plugin-owned surface, the proof must show
the surface was already classified before retry started; otherwise the second
write is a new boundary, not a production-safe continuation of the first one.
That rule also applies when the first write succeeded cleanly: a later write
against a newly discovered plugin-owned surface is not covered by the earlier
success unless the proof separately preserves the remote, blocks or
classifies the late surface, and records a fresh retry scope. A "manual
resolution succeeded" label is false if it only proves the first write on the
smaller surface and never shows the late-discovered surface's own rejection
point, preserved remote, and fresh retry scope. The missing proof is a
durable classification or block for the late surface before the retry starts,
not a broader success label for the earlier boundary.

Production-grade wording must therefore prove, not imply:

- live drift was checked on the actual apply boundary, not on a lab route or
  fixture-shaped smoke;
- the preserved remote stayed auditable after reject, while the stale review
  artifact stayed audit-only and could not authorize a new row, file, or
  plugin-owned surface;
- any create-time rename, alias, or renumber was either durably represented
  with live identity evidence or hard-blocked before mutation;
- any plugin-owned surface outside the allowlist was either enumerated live or
  blocked at apply time, including late-discovered custom tables, generated
  files, cron rows, runtime registries, serialized blobs, and plugin files;
- any partial file, DB, or plugin side effect was classified old, new, or
  blocked before retry started; and
- any Reprint, ZS-Sync, or ForkPress comparison named the exact upstream
  revision or worktree state and was reverified at this repo's live mutation
  boundary, not just cited as historical precedent.

Source-note proof boundary, restated:

- Reprint `27c5f25`, ZS-Sync `d9334a0`, and ForkPress `55f9879` are
  historical design inputs here unless this branch rechecked the exact live
  mutation boundary on the same scenario and preserved the remote for audit.
- Reprint proves staged pull delivery and resumability, not live source push
  safety or stale-authority rejection on this branch.
- ZS-Sync proves bounded scanning and resource discovery, not source-side
  mutation, conflict policy, or late plugin-owned surface handling.
- ForkPress proves merge auditability and reviewed-resolution vocabulary,
  not this branch's live remote-preserving write path or retry authority.
- Those revisions are provenance, not current safety proof: if the branch did
  not rerun the same drifted-remote case here, a source-note citation plus a
  production-shaped route still cannot claim live push safety.
- Reprint source notes prove a resumable pull pipeline, protocol framing, and
  bounded exporters. They do not prove live push mutation safety, stale
  rejection before write, identity remapping on create, or durable recovery
  on this branch.
- ZS-Sync source notes prove continuous scanning, cursoring, and bounded
  resource selection. They do not prove source-side mutation, conflict
  resolution, plugin-owned surface coverage, or partial side-effect
  classification here.
- ForkPress source notes prove merge auditability, reviewed resolution,
  plugin-validator boundaries, and crash-consistency goals. They do not prove
  this branch's live executor rejected stale authority, preserved the remote
  after reject, or handled the full WordPress/plugin surface without missing
  side effects.
- None of those source notes prove production-grade push support on this
  branch unless the exact same live boundary was rerun here and the preserved
  remote, rejection point, and fresh retry scope were recorded from this
  worktree.
- A comparison note that says "comparison passed" must still name the exact
  upstream revision or worktree state, the exact live drift or retry case on
  this branch, and what the upstream state does not prove here. If it does
  not also show the preserved remote and the fresh retry artifact from this
  worktree, the note is historical context only.
- A correct upstream commit or worktree state is provenance, not current
  authority. If the branch did not re-run the same live drift, retry, or
  create-time identity case here, the comparison must stay historical. A
  comparison note that never revalidated the exact live boundary on this
  branch cannot prove the preserved remote, the rejection point, the fresh
  retry scope, or the treatment of late plugin-owned state.
- Even when the upstream state, route family, or package shape matches, the
  comparison is still only provenance until this branch shows the live write
  executor on this worktree rejected stale authority before mutation and kept
  the remote auditable after reject.
- Production-grade wording must also fail closed when the only remaining
  evidence is a readable stale manual-review artifact or a route-shaped
  smoke. Readability is audit value only; it does not prove the stale record
  was rejected before mutation, cannot widen to another row, file,
  relationship-bearing record, plugin-owned surface, or hidden side effect,
  or was separated from fresh retry authority backed by new live hashes.
- Production-grade wording must also fail closed when a production-shaped
  route or packaged mount is used as a proxy for current proof. Route family
  compatibility does not show the live executor rejected stale authority,
  preserved the remote for audit, rebuilt retry scope from fresh live
  hashes on this branch, or blocked late-discovered plugin-owned surfaces
  before the second write.
- Production-grade wording must also fail closed when that same stale
  manual-review artifact is reused to justify a later plugin-owned surface
  such as a cron row, cache entry, runtime registry, generated file, custom
  table, or plugin-owned file. If the proof does not show that surface was
  blocked or classified before retry, the artifact is only historical
  context and cannot authorize the new write.
- Production-grade wording must fail closed when a late-discovered
  plugin-owned surface is widened into a second success claim. If the proof
  does not show the late surface was blocked or durably classified before the
  retry, the second write is not retry proof and does not authorize
  production wording.

Conservative comparison matrix:

- Reprint `27c5f25` proves resumable pull flow, protocol framing, and bounded
  exporter shape.
  - It does not prove this branch's live push executor, stale rejection before
    mutation, preserved-remote auditability, or late plugin-owned surface
    handling.
  - Missing repo proof: a branch-local rerun of the same stale-remote mutation
    boundary with the preserved remote recorded after reject and the stale
    approval made unusable for retry.
- ZS-Sync `d9334a0` proves continuous scanning, cursoring, and bounded
  resource selection.
  - It does not prove source-side mutation safety, create-time identity
    remapping, or plugin-owned surface coverage on this branch.
  - Missing repo proof: a same-boundary live write rerun that shows the remote
    was preserved, the stale attempt was rejected before mutation, and the
    retry scope was rebuilt from fresh live hashes.
- ForkPress `55f9879` proves merge auditability, reviewed resolution, plugin-
  validator boundaries, and crash-consistency goals.
  - It does not prove this branch's live write path preserved the remote,
    blocked late-discovered plugin-owned state, or separated audit-only
    artifacts from retry authority.
  - Missing repo proof: the same drifted-remote case rerun here with fresh live
    hashes, explicit late-surface classification, and a fresh retry scope that
    cannot inherit the stale note.

Production release gate checklist:

- Live remote drift after dry-run must be rejected on the live write path,
  before mutation, with the preserved remote still auditable after reject.
- "Manual resolution" is not success unless the remote was preserved for
  audit, the stale authority was rejected before mutation, and the next
  retry rebuilt scope from fresh live hashes instead of inheriting the old
  decision.
- Any create-time rename, alias, or renumber must be either durably
  represented or hard-blocked before write; if the claim only shows a
  fixture identity map, it is not enough.
- Any plugin-owned surface outside the allowlist, including hidden cron,
  cache, registry, generated-file, custom-table, or plugin-file state, must
  be enumerated or blocked at apply time; a fixture plugin row does not prove
  the rest of the plugin-owned graph is safe.
- Any partial file, DB, or plugin side effect must be classified old, new,
  or blocked, and retry must rebuild scope from fresh live hashes rather than
  from the stale manual-review artifact.
- Any later-discovered partial side effect must not inherit the earlier
  approval. If the branch cannot show the fresh live hash that classified the
  later boundary, the previous success story is incomplete and cannot be
  recast as production-safe retry evidence.
- Any stale manual-review artifact must remain audit-only after drift; it
  cannot become retry authority for another row, file, relationship-bearing
  record, or plugin-owned surface.
- Any stale manual-review artifact must also stay audit-only when the second
  write touches a late-discovered plugin-owned surface; if the proof does not
  show that surface was blocked or durably classified before retry, then the
  earlier artifact cannot authorize the new boundary.
- A readable review artifact may help the operator audit what happened, but it
  does not prove the remote was preserved, the stale boundary was rejected
  before mutation, or the later plugin-owned surface was safely separated from
  the first retry.
- A late-discovered plugin-owned surface cannot be folded into the earlier
  success story just because the first write committed cleanly; the proof must
  show a preserved remote, a separate rejection or classification point for
  the late surface, and a fresh retry scope for that later boundary.
- Any source-note comparison that reuses a readable review artifact for a
  later write must keep the stale note audit-only unless the branch shows the
  exact live boundary, preserved remote, rejection point, and fresh retry
  scope for that later surface on this worktree.
- Any source-note comparison that mentions Reprint, ZS-Sync, or ForkPress
  must also say what the cited upstream state does not prove for this branch,
  so historical context cannot be mistaken for current reliability proof.
- Any source-note comparison that only proves the same feature family, route
  shape, or package mount must stay historical unless it also shows the same
  drifted live boundary on this branch; matching vocabulary is not enough to
  authorize a new write.
- Any Reprint, ZS-Sync, or ForkPress citation must name the exact upstream
  revision or worktree state and show branch-local revalidation of the same
  live boundary; otherwise it is historical context only and cannot become
  retry authority.
- Any source-note comparison that only matches route shape, package layout,
  or `finalMatchesLocal` is still compatibility evidence only until this
  branch reruns the exact live mutation boundary, records the preserved
  remote after reject, and shows the same drift case on this worktree.
- That comparison still cannot claim stale-authority rejection, preserved-
  remote auditability, or fresh retry scope unless this branch records the
  exact live boundary for the same drift case.
- Any claim that relies on route shape, packaged-plugin mount, fixture
  replay, or `finalMatchesLocal` must say explicitly that those are
  compatibility checks, not production proof.
- A release gate that only has source-note provenance, route shape, or
  `finalMatchesLocal` must fail closed until it also shows branch-local live
  drift rejection and a preserved remote that can still be audited after
  reject.
- A release gate that reaches a late-discovered plugin-owned surface must
  still show a separate classification or rejection point for that surface
  plus preserved-remote evidence; a clean first write does not prove the
  later boundary.
- If a manual-review artifact is still readable after drift, readability is
  audit evidence only; the gate still needs reject-before-mutation proof and a
  fresh retry artifact rebuilt from live hashes.

These are the specific failure scenarios that still need branch-local proof:

- Live remote drift after dry-run but before the first write. Missing proof:
  the actual apply path rejected stale authority before mutation, and the
  preserved remote stayed auditable afterward.
- Create-time identity remap, alias, or renumber. Missing proof: durable
  identity evidence for the remap, or a hard block before mutation.
- Plugin-owned state outside the allowlist, including custom tables,
  generated files, cron rows, runtime registries, caches, serialized blobs,
  and other hidden plugin side effects. Missing proof: live enumeration of
  the full surface list, or explicit block at apply time.
- Partial file, DB, or plugin side effects. Missing proof: old/new/blocked
  classification for every touched surface, with retry rebuilt from fresh
  live hashes rather than inherited approval.
- Stale manual-review artifacts that remain readable after drift. Missing
  proof: the artifact stayed audit-only, could not authorize retry, and was
  replaced by a separately recorded fresh retry artifact.

Production-grade push wording remains blocked until the same live boundary
proves all of the following:

- live remote drift after dry-run was rejected before mutation, with the
  preserved remote still auditable after reject and the stale approval unable
  to authorize retry;
- create-time identity remapping, aliasing, or renumbering was either proven
  safe with live identity evidence or hard-blocked before write;
- plugin-owned state outside the allowlist was enumerated live or blocked at
  apply time, including late custom tables, generated assets, cron rows,
  runtime registries, serialized blobs, caches, and plugin-owned files;
- any partial file, DB, or plugin side effect was durably classified as old,
  new, or blocked, and the next retry rebuilt scope from fresh live hashes
  instead of inheriting stale approval;
- any readable stale manual-review artifact stayed audit-only after drift,
  could not widen into another row, file, relationship-bearing record, or
  plugin-owned surface, and could not become retry authority for a later
  discovered surface;
- any source-note comparison to Reprint, ZS-Sync, or ForkPress named the
  exact upstream revision or worktree state and was reverified here against
  the same live mutation boundary; and
- any claim that says "manual resolution" also records the preserved remote,
  the stale rejection point, and a separately recorded fresh retry artifact.

If any one of those proof points is missing, the wording is still
compatibility-only or historical-context-only, not production-grade push
support.

Release gate checklist for any production-readiness wording:

1. The claim names the exact live mutation boundary and the exact stale
   drift case it rechecked here.
2. The claim shows the reject happened before mutation and that the
   preserved remote remained auditable after reject.
3. The claim shows the stale approval or review artifact could not become
   retry authority for a different row, file, relationship-bearing record, or
   plugin-owned surface.
4. The claim shows create-time identity remapping, aliasing, or renumbering
   was either proven safe with live identity evidence or hard-blocked before
   write.
5. The claim shows every touched surface was classified as old, new, or
   blocked before retry started, including any late-discovered plugin-owned
   surface.
6. The claim shows any plugin-owned state outside the allowlist was
   enumerated live or blocked at apply time, not inferred from a fixture or
   source note.
7. The claim shows any partial file, DB, or plugin side effect was recorded
   durably and rebuilt from fresh live hashes rather than inherited approval.
8. The claim names any Reprint, ZS-Sync, or ForkPress comparison with the
   exact upstream revision or worktree state, and says what that note
   proves here and what it does not prove.
9. The claim does not promote route shape, package mount shape,
   fixture replay, `finalMatchesLocal`, or a readable review artifact into
   production proof, because none of those artifacts prove the live mutation
   boundary, preserved remote, stale rejection point, or fresh retry
   authority on this branch.
10. The claim does not treat "manual resolution" as success unless the
    preserved remote, stale rejection point, and fresh retry artifact are all
    recorded on this branch for the same boundary.

Do not let success wording outrun the evidence:

- "manual resolution succeeded" is not acceptable unless the branch shows
  the preserved remote stayed auditable after reject, the stale approval was
  unusable for retry, the fresh retry artifact was recorded on this branch
  for the same live boundary, and any late-discovered plugin-owned surface
  was classified separately rather than folded into the first write;
- "production-ready push support" is not acceptable if the only supporting
  evidence is a route-shaped smoke, lab-shaped route, fixture replay,
  readable review artifact, `finalMatchesLocal`, or a matching upstream note
  without branch-local live revalidation; and
- "safe retry" is not acceptable unless every touched surface is explicitly
  classified as old, new, or blocked and any late-discovered plugin-owned
  surface is handled as a separate boundary, not folded into the earlier
  success story; and
- "comparison passed" is not acceptable unless the note names the exact
  upstream revision or worktree state, states what that state does not prove
  for this branch, and shows the same live drift or retry boundary was
  revalidated here with preserved-remote evidence; and
- a comparison note that names the right Reprint, ZS-Sync, or ForkPress
  revision is still not enough by itself unless this branch reran the same
  live drift or retry case on the same mutation boundary and recorded the
  preserved remote, rejection point, and fresh retry scope here.

The current design still has these production-grade failure traps until the
branch proves otherwise:

- Live remote drift can still be misread as success if the claim only shows a
  route-shaped smoke or a readable review artifact. Missing proof: the actual
  apply path rejected stale authority before mutation and kept the remote
  auditable afterward.
- Create-time identity remap can still lose or reassign a target if the claim
  only preserves the fixture ID shape. Missing proof: live identity evidence
  for the remap, or a hard block before write.
- Plugin-owned state can still hide outside the allowlist if the claim only
  covers one row, option, or fixture asset. Missing proof: live enumeration or
  apply-time blocking of hidden cron, cache, runtime registry, generated
  files, serialized blobs, custom tables, and plugin files.
- Partial file, DB, or plugin side effects can still leave a mixed-write hole
  if the claim only records the successful store. Missing proof: old/new/
  blocked classification for every touched surface, plus a retry rebuilt from
  fresh live hashes instead of inherited approval.
- A stale manual-review artifact can still become false retry authority if it
  stays readable after drift. Missing proof: the artifact remained audit-only,
  could not widen to another row, file, relationship-bearing record, or
  plugin-owned surface, and was replaced by a separately recorded fresh retry
  artifact on the same branch.
- Reprint, ZS-Sync, or ForkPress can still be cited as if they prove current
  safety when they only provide historical context. Missing proof: the exact
  upstream revision or worktree state, the exact live mutation boundary on this
  branch, and what that upstream state does not prove here.

The branch also still needs explicit proof for the following failure modes,
not a generic success label:

- Live remote drift between dry-run and apply: missing proof is the actual
  apply path rejecting stale authority before mutation, plus the preserved
  remote remaining auditable after reject.
- Create-time identity remap or alias: missing proof is live identity
  evidence for the remap, or a hard block before mutation.
- Plugin-owned state outside the allowlist: missing proof is live
  enumeration or apply-time blocking of the full plugin-owned surface, not
  just one fixture row or option.
- Partial file, DB, or plugin side effects: missing proof is old/new/blocked
  classification for every touched surface, with retry rebuilt from fresh
  live hashes instead of inherited approval.
- Stale manual-review artifacts: missing proof is that the artifact stayed
  audit-only after drift, could not authorize a later boundary, and was
  replaced by a separately recorded fresh retry artifact on this branch.
- Reprint, ZS-Sync, or ForkPress comparisons: missing proof is the exact
  upstream revision or worktree state plus branch-local revalidation of the
  same live mutation boundary on this repo.

Before this project can claim production-grade push support, the audit must
show the following with branch-local live evidence, not lab shape:

- the stale remote was rejected before the first write, the preserved remote
  stayed inspectable after reject, and the stale approval could not be reused
  as retry authority for a different row, file, relationship-bearing record,
  or plugin-owned surface;
- create-time identity remapping, aliasing, or renumbering was either proved
  safe with live identity evidence or hard-blocked before mutation;
- any later-discovered plugin-owned surface was classified separately before
  retry, not folded into the earlier success story;
- any partial file, DB, or plugin side effect was classified as old, new, or
  blocked so the next retry rebuilt scope from fresh live hashes instead of
  inheriting stale approval;
- any "manual resolution" claim preserved the remote for audit, recorded the
  stale rejection point, and produced a fresh retry artifact on this branch;
  if a later plugin-owned surface appeared, it had its own separate preserve /
  reject / retry cycle before the earlier approval could matter again;
- any readable review artifact, route-shaped smoke, or `finalMatchesLocal`
  result is treated as compatibility evidence only and cannot prove the live
  executor, the preserved remote, or the stale rejection point;
- any route-shape smoke, packaged-plugin mount, fixture replay, readable
  review artifact, `finalMatchesLocal` result, or lab-shaped route is
  treated as compatibility evidence only; and
- any Reprint, ZS-Sync, or ForkPress citation names the exact upstream
  revision or worktree state, states what that note proves, and explicitly
  states what it does not prove for this branch.

A claim does not become production-grade just because it has a readable
manual-review artifact, a route-shaped smoke, or a named upstream note. It
must still prove the live write boundary on this branch, preserve the remote
for audit after reject, and show the fresh retry scope was rebuilt from live
hashes rather than inherited from a stale approval.

Do not let the release gate downgrade missing proof into a softer wording
bucket. A claim is still not production-grade if it says the comparison or
manual resolution "passed" but does not also name the preserved remote, the
stale rejection point, the fresh retry artifact, and the exact live mutation
boundary where the new boundary was reclassified. A readable stale artifact
or a matching upstream note remains audit evidence only until this branch
shows that it was unusable as retry authority for the later boundary and any
later plugin-owned surface received its own separate classification.

If the project wants production-grade push wording, the proof must also show
that Reprint, ZS-Sync, and ForkPress are being cited as named upstream
provenance, not as substitute runtime evidence. That means each comparison
must include the exact upstream revision or worktree state, the scenario it
was rerun against on this branch, and a plain statement of what still failed
to prove here, especially for live drift rejection, create-time identity
remapping, and plugin-owned surfaces discovered after the first write. A
comparison note that lacks that branch-local rerun is historical context
only, even if the note is readable and seems production-shaped.
The same rule applies to a route-shaped smoke or fixture replay that happens
to match the note: if this branch did not rerun the exact live boundary and
record the preserved remote, stale rejection point, and fresh retry scope,
the matching note stays compatibility evidence only.

Mixed writes need one more explicit failure mode on the record: if the first
write succeeds, then a later snapshot reveals a different row, file,
relationship-bearing record, or plugin-owned surface in the same logical
change, the earlier approval is stale by definition. The proof must show the
later surface was either blocked or separately classified before retry, and
it must do so with preserved-remote evidence on this branch. Without that,
the claim can still hide a second-write data-loss path behind "manual
resolution" language.

Source-note comparison boundary:

- Reprint proves staged pull delivery, resumability, and transport framing
  in its observed historical state. It does not prove live push mutation,
  stale remote rejection, create-time remapping, plugin-owned allowlist
  coverage, or mixed-write classification on this branch.
- ZS-Sync proves bounded scanning, resource discovery, and batching ideas in
  its observed historical state. It does not prove source-site mutation,
  runtime ownership discovery, apply-time blocking of hidden plugin state,
  or recovery from a live remote drifted between dry-run and apply on this
  branch.
- ForkPress proves audit vocabulary, merge-review framing, and crash-
  consistency intent in its observed historical state. It does not prove a
  live executor, preserved-remote retry authority, or that a readable
  manual-review artifact can safely authorize a later retry boundary on this
  branch.

Missing repo proof before any production-grade push claim:

- Reprint still needs a live source-site push boundary on this branch that
  rejects stale remote drift before the first write, preserves the remote for
  audit, and rebuilds retry scope from fresh live hashes.
- ZS-Sync still needs proof that discovery and batching do not miss or
  misclassify live plugin-owned surfaces, especially late-discovered tables,
  files, cron rows, runtime registries, generated assets, or serialized
  blobs.
- ForkPress still needs proof that review vocabulary does not become retry
  authority after drift, and that a readable manual-resolution artifact
  cannot authorize a different row, file, relationship-bearing record,
  remapped create target, or plugin-owned surface.
- None of the three notes proves that route shape, package mount shape,
  fixture replay, or `finalMatchesLocal` is safe enough to call production-
  grade on this branch without the same live boundary rerun here.

Release gate additions needed before production-grade push support:

1. A live remote-drift case must fail closed before the first write and leave
   the preserved remote auditable after rejection.
2. A create-time identity remap or alias case must be either durably proven
   safe with live identity evidence or hard-blocked before write. A fixture
   that keeps the same ID is not enough if the live target can renumber or
   alias the row, file, or relationship-bearing record.
3. Every plugin-owned surface outside the allowlist must be enumerated live or
   blocked at apply time, including late-discovered tables, generated files,
   cron rows, runtime registries, serialized blobs, caches, and plugin files.
   The proof must cover both the first write and the next live snapshot if the
   extra surface appears only after initial success.
4. Every partial file, DB, or plugin side effect must be durably classified as
   old, new, or blocked before retry, and the next retry must rebuild from
   fresh live hashes instead of inherited approval. Mixed success/failure is
   not production-safe until the branch shows how the surviving partial state
   is preserved for audit and prevented from being relabeled as success.
5. Any readable stale manual-review artifact must remain audit-only after
   drift and must not become retry authority for a different row, file,
   relationship-bearing record, remapped create target, or plugin-owned
   surface. Readability alone is not proof that the remote was preserved or
   that retry scope was rebuilt. The proof must show the rejection point, the
   preserved remote, and the fresh retry artifact for the same boundary.
6. Any route-shape smoke, packaged-plugin mount, fixture replay, readable
   review artifact, or `finalMatchesLocal` result must be described as
   compatibility evidence only. A lab-shaped or fixture-shaped route family
   does not prove production safety, and a production-shaped URL path does
   not prove the live executor, auth path, or write boundary was production-
   safe. If the claim implies durability, retry authority, or production
   safety, it must also show the live rejection point, preserved remote, and
   fresh retry artifact from this branch.
7. Any Reprint, ZS-Sync, or ForkPress citation must name the exact upstream
   revision or worktree state, say what that note proves here, and say what it
   does not prove. A named note can justify transport shape, discovery shape,
   or review vocabulary, but not live mutation safety on this branch. If the
   note is the only evidence, production wording must fail closed until this
   branch reruns the same live boundary, records the preserved remote, and
   rebuilds retry scope from fresh live hashes. Matching the note's route
   family, package layout, or reviewer wording does not convert upstream
   provenance into current retry authority, and a route-shaped smoke can still
   mask a stale remote, remapped create target, or late plugin-owned surface.
   If the branch did not rerun the same live boundary, a matching route shape,
   fixture replay, or `finalMatchesLocal` result still cannot promote the note
   into current proof.
8. The release gate must fail closed and record the exact rejection reason
   whenever any of the above proofs is missing; route shape, package mount,
   fixture replay, readable review artifacts, source-note comparison, and
   `finalMatchesLocal` are compatibility evidence only. They do not prove the
   live executor ran, and they do not replace a live drift-rejection proof.
   They also do not prove that a production-shaped URL family or package
   layout was safe on the live boundary.
9. Any late-discovered plugin-owned surface must be treated as a separate
   live boundary with its own preserved remote, rejection point, and fresh
   retry scope. A proof for the first write does not authorize that later
   surface, even if the route shape, package mount, or `finalMatchesLocal`
   result is unchanged.
10. Proof for one live boundary is non-transferable: if the first boundary
    was preserved, rejected, and retried correctly, that proof still cannot
    be recycled for a later row, file, relationship-bearing record, remapped
    create target, or plugin-owned surface. A matching route family, mount,
    reviewer note, or hash shape is compatibility evidence only, not a new
    authority grant.

Release-readiness checklist:

- the exact live boundary and stale-drift case are named;
- the preserved remote is still auditable after rejection;
- the stale approval, review artifact, or comparison note cannot widen to a
  different row, file, relationship-bearing record, remapped create target,
  or plugin-owned surface;
- the fresh retry artifact is rebuilt from live hashes on this branch, not
  inherited from earlier approval or a source note;
- every touched surface is classified as old, new, or blocked before retry;
- every plugin-owned surface outside the allowlist is enumerated or blocked
  live, including late-discovered tables, files, cron rows, runtime
  registries, serialized blobs, caches, and generated assets; and
- route shape, package mount shape, fixture replay, readable review output,
  and `finalMatchesLocal` are treated as compatibility evidence only.

Short fail-closed gate for production wording:

- the same live write boundary was rerun on this branch;
- the preserved remote stayed auditable after reject, and the stale rejection
  point is named;
- the fresh retry scope was rebuilt from live hashes on this branch, not
  inherited from a readable review artifact or earlier approval;
- any late-discovered plugin-owned surface was separately classified as old,
  new, or blocked before retry;
- the claim does not widen a stale approval into a different row, file,
  relationship-bearing record, remapped create target, or plugin-owned
  surface;
- any Reprint, ZS-Sync, or ForkPress citation names the exact upstream
  revision or worktree state and says whether it was rerun against the same
  live boundary here; and
- route shape, package mount shape, fixture replay, readable review output,
  and `finalMatchesLocal` stay compatibility evidence only.

False reliability claims to reject:

- "manual resolution succeeded" when the preserved remote, rejection point,
  and fresh retry scope are not all recorded on this branch for the same
  live boundary;
- "manual resolution later" when the stale artifact is still being reused as
  authority for a different row, file, relationship-bearing record, remapped
  create target, or plugin-owned surface instead of being treated as audit-
  only after drift; once the later surface is discovered, the old artifact is
  stale by definition unless this branch records a separate preserve / reject
  / retry cycle for that exact later boundary, and the preserved remote from
  the first boundary remains audit-only rather than becoming retry authority;
  the earlier manual-review note cannot be promoted into retry authority for
  the later boundary just because the route family, package mount, or
  reviewer wording still looks the same;
- "plugin-safe push" when any plugin-owned surface outside the allowlist,
  including a late-discovered table, file, registry entry, generated asset,
  cache entry, cron row, or serialized blob, is still only implied rather
  than enumerated or blocked live, or when a later-discovered plugin-owned
  surface is folded into the first success story without its own preserved
  remote, rejection point, and fresh retry artifact; and
- "plugin-safe push" when any plugin-owned table, file, cron row, runtime
  registry entry, generated asset, cache entry, or serialized blob is outside
  the allowlist and the branch cannot show it was blocked before write; and
- "comparison passed" when a Reprint, ZS-Sync, or ForkPress note does not
  name the exact upstream revision or worktree state and does not say what
  the note proves here versus what it does not prove.
- "production-safe route" when the only evidence is a production-shaped URL
  family or package layout but the branch has not proven the live executor,
  the preserved remote, stale-artifact rejection, and the fresh retry scope
  on this branch.
- "source-note proof" when a Reprint, ZS-Sync, or ForkPress note only
  happens to match the same route family, package layout, or reviewer
  wording; shape similarity is compatibility evidence only and does not
  prove the live executor, preserved remote, or fresh retry scope on this
  branch. A named upstream note is still historical until this branch reruns
  the same live boundary and keeps the remote auditable.
- "manual resolution succeeded" when the preserved remote, rejection point,
  and fresh retry artifact are not all recorded for the same live boundary.
- "manual resolution succeeded" when the same readable artifact is widened
  to a later remapped create target or later-discovered plugin-owned surface
  just because the route family, package mount, or reviewer wording still
  matches.
- "manual resolution succeeded" when a later-discovered plugin-owned table,
  file, cron row, runtime registry entry, generated asset, cache record, or
  serialized blob appears after the first write but never gets its own
  preserve / reject / retry cycle; the earlier note stays audit-only and
  cannot cover the new surface by route-shape similarity alone.

Production wording must also satisfy the release gate in
[`audits/release-gate.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/critic/audits/release-gate.md).
That checklist is the claim gate, not a supplemental note. If any item is
missing, the wording stays lab-backed, comparison-only, or audit-only.

One more false-reliability trap to reject explicitly:

- a matching route family, package mount, fixture replay, readable review
  artifact, or `finalMatchesLocal` result can still come from a copied or
  fixture-backed executor behind the same URL shape, so none of those
  outcomes prove the live write path rejected stale authority before the
  first mutation, preserved the remote, or rebuilt retry authority from fresh
  live hashes; a production-shaped route can still be served by the wrong
  executor, so shape is compatibility evidence only.
- a preserved remote that is still auditable after rejection is not itself
  retry authority; if the branch does not also record the stale rejection
  point and a fresh retry artifact rebuilt from live hashes for the same
  boundary, the preserved remote is only audit evidence and cannot justify a
  second write.
- a later-discovered plugin-owned table, file, cron row, runtime registry,
  generated asset, cache entry, or serialized blob is a new boundary until
  this branch records its own preserve / reject / retry cycle; the first
  route-shaped smoke or manual-review artifact cannot certify that later
  surface, even if the route family, package mount, or reviewer wording is
  unchanged.

Production-readiness language checklist:

- name the exact live boundary and the exact stale-drift case;
- show the preserved remote stayed auditable after rejection;
- show the stale approval, review artifact, or comparison note was rejected
  before mutation and cannot widen to a different row, file, relationship-
  bearing record, remapped create target, or plugin-owned surface;
- show the fresh retry artifact was rebuilt from live hashes on this branch,
  not inherited from earlier approval or copied from a note;
- show the preserved remote, rejection point, and retry scope do not transfer
  to a later row, file, relationship-bearing record, remapped create target,
  or plugin-owned surface just because the route family, package mount, or
  reviewer wording matches; the later boundary still needs its own live proof
  or hard block;
- classify every touched surface as old, new, or blocked before retry starts;
- enumerate or block every plugin-owned surface outside the allowlist,
  including late-discovered tables, files, cron rows, runtime registries,
  serialized blobs, caches, and generated assets;
- treat route shape, package mount shape, fixture replay, readable review
  output, lab-shaped route output, copied-executor output, and `finalMatchesLocal` as compatibility evidence only; and
- name the exact upstream revision or worktree state for any Reprint,
  ZS-Sync, or ForkPress comparison, plus what that note proves here and what
  it does not prove.

A stale manual-review artifact is also not success by itself: if it remains
readable after drift, the note still has to show the preserved remote, the
stale authority rejection point, and a fresh retry artifact rebuilt from live
hashes on this branch.

Production-grade push support is still blocked until all of the following are
true on this branch:

- live remote drift between dry-run and apply is rejected before the first
  write, and the preserved remote stays auditable after rejection;
- create-time identity remapping, aliasing, or renumbering is either proven
  safe with live identity evidence or hard-blocked before write;
- every plugin-owned surface outside the allowlist is either enumerated live
  or blocked at apply time, including late-discovered tables, generated
  files, cron rows, runtime registries, serialized blobs, caches, and plugin
  files;
- any partial file, DB, or plugin side effect is classified as old, new, or
  blocked before retry, so mixed writes cannot be relabeled as success;
- any stale manual-review artifact stays audit-only after drift and cannot
  become retry authority for a different row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface;
- any "manual resolution succeeded" or "comparison passed" wording stays
  audit-only unless the preserved remote, stale rejection point, and fresh
  live-hash retry scope are all recorded on this branch for the same live
  boundary;
- any route-shaped smoke, packaged-plugin mount, fixture replay, readable
  review artifact, or `finalMatchesLocal` result is treated as compatibility
  evidence only; and
- any manual-resolution label is audit-only unless it also preserves the
  remote for audit, records the stale rejection point before mutation, and
  rebuilds a fresh retry artifact from live hashes for the same boundary;
- any Reprint, ZS-Sync, or ForkPress comparison names the exact upstream
  revision or worktree state and says what that note proves here and what it
  does not prove, including whether it applies only to the original boundary
  or is being stretched to a later one.
- any Reprint, ZS-Sync, or ForkPress note that merely matches the same route
  family, package layout, or reviewer wording is still historical context
  only and cannot be recast as live proof for this branch or a later
  boundary, even if the cited upstream commit is named correctly;
- the proof for the first boundary is not being recycled for a later
  boundary just because the route family, package mount, fixture replay, or
  reviewer wording still looks the same, or because the later boundary uses
  the same local labels, file names, or approval language;
- a route-shaped smoke, fixture replay, or `finalMatchesLocal` result can
  still come from a copied or fixture-backed executor behind the same URL
  shape, so shape alone is compatibility evidence only and not proof of live
  write safety, remote preservation, or retry authority.

Route-shaped smokes and fixture replays are useful compatibility evidence, but
they do not establish production safety unless the branch separately proves the
live executor, preserved remote, stale-artifact rejection, and fresh retry
scope for the exact same boundary.

Minimum proof still missing for any production-grade claim:

- the exact live boundary that was rerun here, not just a matching route or
  package shape;
- the preserved remote after rejection, with audit evidence that remains
  inspectable but cannot authorize retry by itself;
- the stale approval or review artifact rejecting point, including proof that
  it cannot widen to a different row, file, relationship-bearing record,
  remapped create target, or plugin-owned surface;
- the fresh retry artifact rebuilt from live hashes on this branch rather than
  inherited from a note, fixture, or earlier approval;
- old/new/blocked classification for every touched surface, including any late-
  discovered plugin-owned table, file, cron row, runtime registry, generated
  asset, cache entry, or serialized blob; and
- a separate preserve / reject / retry cycle for any later-discovered plugin-
  owned surface that appears after the first write.

If the branch cannot show that the stale manual-review artifact is unusable as
current retry authority, the claim is still false even when the route, mount,
fixture, or `finalMatchesLocal` output looks production-shaped. A later
plugin-owned row, file, registry entry, cache record, serialized blob,
generated asset, or cron side effect is a new boundary until this branch
records its own preserve / reject / retry cycle; the earlier review note stays
audit-only and cannot be widened to cover that surface, and the preserved
remote from the first boundary does not satisfy the proof obligation for the
later one.

Conservative comparison rule: a Reprint, ZS-Sync, or ForkPress citation must
name the exact upstream revision or worktree state, say exactly what the note
does prove here, and say exactly what it does not prove here. If that note is
being used to imply live write safety, remote preservation, stale-drift
rejection, or retry authority on this branch, the proof is missing and the
claim must fail closed.
That rule also applies to any later-discovered plugin-owned boundary: a note
that only covered the original row, file, or relation cannot silently widen to
cover a new table, registry entry, generated asset, cache entry, serialized
blob, or cron side effect without its own preserve / reject / retry evidence.
Named upstream state is necessary provenance, not sufficient proof: even the
exact Reprint `27c5f25`, ZS-Sync `d9334a0`, or ForkPress `55f9879` anchor
still remains historical context until this branch reruns the same live
boundary and preserves the drifted remote for audit.

## Production Gate Summary

The branch is still not production-grade because the remaining proof gaps are
boundary-specific, not wording-specific:

- live remote drift still needs a live rerun that fails closed before the first
  write and leaves the remote inspectable after reject;
- create-time identity remapping still needs live identity evidence or a hard
  block, because a fixture that preserves the same ID does not prove the live
  target cannot renumber or alias;
- plugin-owned state outside the allowlist still needs live enumeration or an
  apply-time block, including hidden tables, cron rows, runtime registries,
  generated files, caches, serialized blobs, and plugin-owned files that only
  appear after the first write;
- partial file, DB, and plugin side effects still need old/new/blocked
  classification before retry, so a mixed write cannot be relabeled as
  success;
- stale manual-review artifacts still need an explicit preserve/reject/retry
  cycle for each later-discovered boundary, because a readable artifact is
  audit evidence only until the branch proves it cannot authorize a different
  row, file, relationship-bearing record, remapped create target, or plugin-
  owned surface. If a later plugin-owned table, file, registry entry,
  generated asset, cache entry, serialized blob, or cron row appears after
  the first write, the earlier artifact stays audit-only and cannot cover the
  new surface without its own preserve / reject / retry cycle, even when the
  route shape, reviewer wording, or fixture replay matches the first boundary;
  and
- Reprint, ZS-Sync, and ForkPress notes still need to be treated as source-note
  provenance only unless the exact upstream state is named and this branch
  reran the same live boundary with preserved-remote evidence; even then, the
  note proves only the cited boundary and does not transfer retry authority to
  a later row, file, remapped create target, or plugin-owned surface.
- a named upstream anchor plus matching route family, package mount, or
  reviewer wording still does not prove that the live executor on this branch
  preserved the remote, rejected stale authority before mutation, or rebuilt
  retry scope from fresh live hashes;
- The approach scorecard in `docs/approach-scorecard.md` is only a design
  heuristic. Even the highest reliability score there does not prove stale
  authority was rejected before mutation, the remote was preserved for audit,
  or retry scope was rebuilt from fresh live hashes on this branch.

The local source-note anchors in `docs/source-notes.md` are the observed
historical references `27c5f25` for Reprint, `d9334a0` for ZS-Sync, and
`55f9879` for ForkPress. Those anchors can justify the historical names used
for transport, discovery, and review vocabulary, but they do not prove live
push safety, preserved-remote retention, create-time remap safety, retry
authority, or plugin-owned surface handling on this branch. Even when the
exact upstream revision or worktree state is named, the note is still
historical context only until this branch reruns the same live boundary and
preserves the drifted remote for audit. The missing proof is branch-local and
live: the exact stale-drift case was rejected before the first write, the
remote stayed auditable after rejection, and each later-discovered
plugin-owned surface was either blocked or given its own preserve / reject /
retry cycle. Matching the same route family, package layout, reviewer wording,
or historical note title remains compatibility evidence only.

Conservatively compared:

- Reprint can support staged transport and resumability vocabulary, but not
  live source mutation safety, stale-remote rejection, or create-time identity
  remapping proof on this worktree;
- ZS-Sync can support bounded discovery and cursoring vocabulary, but not
  source-side write safety, partial-write classification, or plugin-owned
  surface enumeration proof here; and
- ForkPress can support merge-audit and crash-consistency vocabulary, but not
  the live executor, preserved-remote audit trail, or manual-review authority
  for a different row, remapped create target, or late-discovered
  plugin-owned surface on this branch.

One remaining false-reliability trap is the "preflight looked fine, so manual
resolution later succeeded" story. If the remote drifted between preflight and
apply, or if a plugin-owned surface only appeared after the first write, the
branch still needs a separate preserve / reject / retry cycle for that exact
boundary. Missing proof: the preserved remote stayed inspectable after
rejection, the stale authority was rejected before mutation, and the later
surface was either blocked or given its own live-hash retry scope on this
worktree. A readable review note, comparison note, or route-shaped smoke does
not close that gap unless it is paired with the preserved remote, the exact
rejection point, and the fresh retry artifact rebuilt from live hashes for the
same boundary.

Before the project can claim production-grade push support, the audit must be
able to name all of the following for the exact same live boundary on this
worktree:

- the drifted remote that was preserved for audit;
- the stale rejection point that made the earlier approval unusable as retry
  authority;
- the fresh retry artifact rebuilt from live hashes on this branch;
- the old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface;
- the separate classification or block for any late-discovered plugin-owned
  surface that appeared only after the first write, plus a fresh preserve /
  reject / retry cycle if that surface is writable; and
- the separate classification or block for any remapped create target that
  only became visible during retry, plus a fresh preserve / reject / retry
  cycle if that target is writable; and
- the exact upstream revision or worktree state for any Reprint, ZS-Sync, or
  ForkPress comparison, plus an explicit statement of what that note proves
  here and what it does not prove, including whether it says anything about a
  later boundary or only the original one.
Historical source notes stay historical even when they match the same route
family, package mount, or reviewer wording; they do not certify a later live
retry boundary unless the branch separately reran that exact boundary here.
Even an exact upstream anchor only proves the note's original historical
context; it does not prove that a readable manual-review artifact can be
reused as retry authority for a different row, file, relationship-bearing
record, remapped create target, or plugin-owned surface on this branch.
If the branch cannot name those items for the exact live boundary, then any
"manual resolution succeeded" wording is still false reliability, even when the
route shape, fixture replay, or review artifact looks production-shaped. The
same is true if a later-discovered plugin-owned surface or remapped create
target is folded into the first approval without its own preserve / reject /
retry cycle on this branch.
That includes any later row, file, relationship-bearing record, or remapped
create target that only becomes visible after the first write; it still needs
its own preserve / reject / retry cycle, even if the earlier review artifact
still looks valid.

Release-readiness filter:

- if the branch only shows route shape, package mount shape, fixture replay,
  readable review output, or `finalMatchesLocal`, the production claim must
  fail closed;
- if manual resolution is the only stated success path, the remote must still
  be preserved for audit, the stale artifact must be unusable as retry
  authority, and the fresh retry artifact must be rebuilt from live hashes on
  this worktree;
- if a late-discovered plugin-owned surface appears after the first write, it
  is a separate boundary until it gets its own reject/classify/retry cycle;
  and
- if a comparison note is used as proof, it must name the exact upstream
  state and state plainly what it does not prove here.
If any claim depends on a historical Reprint, ZS-Sync, or ForkPress note, the
note must stay historical context only unless this branch separately reran the
same live boundary and preserved the remote that actually drifted. Naming the
exact upstream revision or worktree state is still not enough by itself; the
live boundary on this branch has to be revalidated too.

Do not let a lab-shaped route, package mount, fixture replay, or
`finalMatchesLocal` output stand in for the live boundary above. Those signals
can show compatibility with the expected URL shape or review flow while the
real production executor is still copied, fixture-backed, or missing the
preserve / reject / retry cycle for a drifted remote, a remapped create target,
or a late-discovered plugin-owned surface.

Current blocking scenarios still needing branch-local proof:

- live remote drift between preflight and apply, where the write must fail
  before the first mutation and keep the rejected remote auditable for retry;
- create-time identity remapping, aliasing, or renumbering, where a fixture or
  review note can preserve the wrong shape without proving the live target
  stayed stable;
- plugin-owned state outside the allowlist, including hidden tables, files,
  cron rows, runtime registries, generated assets, caches, and serialized
  blobs that may appear after the first write;
- mixed file, database, and plugin side effects, where only the committed
  subset is visible unless the surviving state is classified as old, new, or
  blocked before retry; and
- stale manual-review artifacts, where a readable note survives drift but has
  not been separately rejected, preserved, and rebuilt into a fresh retry
  scope for a later boundary.

Release-readiness wording must also fail closed if it:

- implies that a later-discovered plugin-owned surface inherits the first
  boundary's retry authority;
- treats a route-shaped smoke or `finalMatchesLocal` result as proof that a
  copied or fixture-backed executor was not involved;
- collapses partial file, DB, or plugin side effects into success without
  naming the old/new/blocked classification for every touched surface; or
- cites Reprint, ZS-Sync, or ForkPress as current proof without naming the
  exact upstream revision or worktree state and stating what the note does
  not prove here.

Specific false-reliability trap to reject:

- if preflight, route shape, or a readable review artifact matches the earlier
  plan but the remote has drifted before apply, the branch must not say
  "manual resolution succeeded"; the artifact is audit-only until the remote
  is preserved, the stale authority is rejected before mutation, and the retry
  scope is rebuilt from live hashes for that exact boundary;
- if the first write exposes a later plugin-owned table, file, cron row,
  runtime registry entry, generated asset, cache entry, or serialized blob,
  that surface is a new boundary and cannot inherit the first approval without
  its own preserve / reject / retry cycle; and
- if a mixed file, database, and plugin run leaves only part of the state
  committed, the surviving part must be labeled old, new, or blocked before
  retry; partial success wording is false reliability unless the untouched
  surfaces are separately accounted for.

Minimum evidence still missing for production wording:

- live proof that stale authority fails before the first mutation and that
  the rejected remote remains inspectable after reject;
- live proof that any create-time remap case is either preserved safely or
  hard-blocked before write, and that a remapped target discovered during
  retry cannot inherit the first approval;
- live enumeration or explicit blocking for every plugin-owned surface
  outside the allowlist, including late-discovered surfaces that appear after
  the first write;
- old/new/blocked classification for the full mixed write path, not just the
  successful subparts; and
- source-note comparisons that name the exact upstream state, say what the
  note proves here and what it does not prove here, and stay historical unless
  the same live boundary was rerun on this branch.
Any production-grade push claim that lacks one of those proofs must be treated
as incomplete, not "close enough for manual resolution."

Release-gate checklist for production-grade wording:

- exact live boundary identified, with the drifted remote preserved for audit;
- stale authority rejected before the first mutation, with the rejection point
  recorded and reusable only as audit evidence for that same boundary;
- create-time remap, alias, or renumber cases either blocked before write or
  proven with live identity evidence, not inferred from the earlier boundary;
- every plugin-owned surface outside the allowlist enumerated or explicitly
  blocked, including late-discovered tables, files, cron rows, registries,
  generated assets, caches, and serialized blobs;
- every mixed file, database, and plugin side effect classified as old, new,
  or blocked before retry, so a partial commit cannot be relabeled as success;
- manual-review artifacts kept audit-only unless rebuilt from fresh live
  hashes on this branch for the exact same boundary;
- any cited Reprint, ZS-Sync, or ForkPress note pinned to the exact upstream
  revision or worktree state, annotated with what it proves here, what it
  does not prove here, and whether any later boundary is explicitly in scope
  or explicitly excluded;
- a note with the same route family, mount layout, or reviewer vocabulary is
  still compatibility-only unless this branch reran the same live boundary
  with fresh hashes and preserved-remote evidence;
- any source-note comparison that only matches route family, package mount,
  or reviewer wording is rejected as compatibility evidence only, even if
  the note is otherwise well formed;
- any later-discovered plugin-owned surface is treated as a new boundary
  unless it gets its own preserve / reject / retry cycle on this branch; and
- any later boundary that reuses the same route family, mount layout, or
  reviewer vocabulary is still a fresh live boundary, so it needs its own
  preserved remote, stale-artifact rejection, and retry scope rebuilt from
  live hashes; and
- no route-shape smoke, package-mount match, `finalMatchesLocal`, or
  "manual resolution" phrase may be used as proof without the live boundary
  above.
If any box is unchecked, the branch must not claim production-grade push
support, because route shape and upstream comparison can still be
compatibility evidence only.

Failure scenarios and missing proof:

- live remote drift after preflight but before apply: missing proof is a
  branch-local live rerun that fails closed before the first write, preserves
  the rejected remote for audit, and rebuilds retry scope from fresh live
  hashes on this worktree;
- route-shape, package-layout, or fixture-backed proof that only reproduces
  the same path shape: missing proof is the live executor state, live hashes,
  and preserved remote for the exact boundary that actually drifted;
- create-time identity remap, aliasing, or renumbering: missing proof is live
  identity evidence for the exact target that was written or an explicit hard
  block before write, plus proof that a remapped target discovered later does
  not inherit the first approval;
- plugin-owned state outside the allowlist: missing proof is live
  enumeration or explicit blocking for every hidden table, file, cron row,
  runtime registry entry, generated asset, cache entry, and serialized blob,
  including surfaces discovered only after the first write;
- partial file, DB, or plugin side effects: missing proof is old/new/blocked
  classification for every touched surface before retry, so a mixed commit
  cannot be relabeled as success after only the surviving subparts are
  visible; and
- stale manual-review artifacts: missing proof is that the readable artifact
  stayed audit-only after drift, could not authorize a different row, file,
  relationship-bearing record, remapped create target, or plugin-owned
  surface, and was replaced by a fresh retry artifact rebuilt from live
  hashes.

Production-grade release gate:

- show the exact live boundary rerun on this branch, not just a matching
  route family, package mount, fixture replay, or `finalMatchesLocal` result;
- show the remote preserved for audit after rejection, plus the stale
  rejection point that made the first approval unusable for retry;
- show live identity evidence or an explicit hard block for any create-time
  remap, alias, or renumbered target;
- show every touched file, DB row, relationship-bearing record, and
  plugin-owned surface classified as old, new, or blocked before retry;
- show any late-discovered plugin-owned surface was treated as a new boundary
  with its own preserve / reject / retry cycle, not folded into the earlier
  approval;
- show any plugin-owned data trap outside the allowlist, including hidden
  tables, cron rows, runtime registries, generated files, caches, serialized
  blobs, and plugin-owned files, was enumerated before write or blocked as a
  new boundary; otherwise the later discovery is not proof of production
  safety;
- show any readable manual-review artifact stayed audit-only after drift and
  could not authorize a later row, file, remapped create target, or plugin-
  owned surface; and
- show that any later-discovered plugin-owned table, file, cron row, runtime
  registry entry, generated asset, cache entry, or serialized blob was treated
  as a new boundary with its own preserve / reject / retry cycle, not as a
  continuation of the earlier readable artifact;
- show each Reprint, ZS-Sync, or ForkPress comparison names the exact
  upstream state, states what the note proves here, and states what it does
  not prove here; a named upstream state is historical provenance only, not
  current retry proof, until this branch reruns the same live boundary with
  preserved-remote evidence and fresh live hashes.

Single-sentence release gate:

- this branch may only claim production-grade push support when the exact live boundary on this worktree shows the drifted remote preserved for audit, stale authority rejected before the first write, fresh retry scope rebuilt from live hashes, every touched surface classified old/new/blocked, and every late-discovered plugin-owned surface either blocked or given its own preserve / reject / retry cycle; if any part of that proof is missing, then route shape, package layout, reviewer wording, readable artifacts, `finalMatchesLocal`, and Reprint / ZS-Sync / ForkPress comparisons stay compatibility evidence only and cannot be promoted to current production proof.

Proof-substitution fail-closed rule:

- a readable manual-review artifact, comparison note, or route-shaped smoke
  cannot be promoted to retry authority for a later-discovered plugin-owned
  surface, remapped create target, or new row/file/relationship-bearing
  record unless this branch separately preserves the remote, rejects stale
  authority before mutation, and rebuilds retry scope from live hashes for
  that later boundary; the preserved remote must stay independently
  inspectable so the operator can audit the drift and safely retry from fresh
  live hashes. Otherwise the later surface remains blocked or audit-only,
  regardless of how similar it looks to the earlier boundary.
- if the later boundary reuses the same route family, package mount,
  reviewer wording, or upstream anchor, that similarity still does not
  transfer retry authority; the earlier artifact remains audit evidence only
  until this branch shows the later boundary's own preserved remote, stale
  rejection point, and fresh retry scope rebuilt from live hashes.
- if the later boundary is a plugin-owned table, file, cron row, runtime
  registry entry, generated asset, cache entry, serialized blob, or other
  plugin-owned surface discovered after the first write, the earlier readable
  artifact still cannot authorize it just because the route family or reviewer
  wording matches; that later surface needs its own preserve / reject / retry
  cycle on this branch or it remains blocked or audit-only.

Source-note comparison rule:

- Reprint `27c5f25` only supports staged transport, resumability vocabulary, and chunked delivery framing; it does not prove stale remote drift rejection, preserved-remote auditability, create-time remap safety, or late plugin-surface classification on this branch.
- ZS-Sync `d9334a0` only supports bounded discovery, cursoring, and batched resource selection; it does not prove source mutation safety, retry authority, or recovery from partial side effects on this branch.
- ForkPress `55f9879` only supports merge-audit vocabulary and crash-consistency intent; it does not prove that a readable review artifact can authorize a later row, file, remapped create target, or plugin-owned surface on this branch.
- none of those notes proves that a later-discovered plugin-owned surface or remapped create target belongs to the same live boundary as the earlier readable artifact; if the later surface appears after the first write, it is a new boundary until this branch separately preserves the remote, rejects stale authority, and rebuilds retry scope from live hashes for that later surface.
- any comparison that does not explicitly say what the note proves here and what it does not prove here is ambiguous and must fail closed; a source note that only names a similar route family, package mount, production-shaped URL, or reviewer vocabulary is still compatibility context, not production proof.
- a note that reuses the same route family, package mount, reviewer wording, or upstream anchor still does not prove the same live boundary was rerun here; if the preserved remote was not shown, the stale authority rejection point was not shown, and the fresh retry scope was not rebuilt from live hashes on this branch, then the comparison remains historical context only.

Evidence-classification rule:

- if a note, artifact, or smoke does not explicitly say whether it is historical context, compatibility evidence, or live retry proof, the wording is ambiguous and must fail closed;
- a Reprint, ZS-Sync, or ForkPress citation is historical context unless the exact upstream state and the same live boundary were rerun here;
- a readable manual-review artifact stays audit evidence only unless it is paired with the preserved remote, the rejection point, and a fresh retry scope rebuilt from live hashes on this branch; a later-discovered row, file, relationship-bearing record, remapped create target, or plugin-owned surface still needs its own preserve / reject / retry cycle and cannot inherit that artifact; and
- a comparison note that only matches route family, package mount, or reviewer wording still cannot become retry authority for a later-discovered row, file, relationship-bearing record, remapped create target, or plugin-owned surface;
- that same artifact still cannot authorize a later-discovered plugin-owned surface, remapped create target, or different row/file/relationship-bearing record just because the route family, package mount, or reviewer wording stayed the same; and
- route shape, package mount shape, production-shaped URL, fixture replay, readable review output, and `finalMatchesLocal` stay compatibility evidence only and cannot be upgraded into proof for a later row, file, relationship-bearing record, remapped create target, or plugin-owned surface.

Production-grade blocker summary:

- live remote drift is still unproven if the branch cannot show the exact apply boundary that rejected stale authority before the first write, preserved an inspectable remote for audit, and rebuilt retry scope from fresh live hashes;
- create-time identity remapping is still unproven if the branch only matches route shape or fixture shape; the proof must either show live identity evidence for the remapped target or hard-block the remap before write;
- plugin-owned data traps are still unproven if any hidden table, serialized blob, cron row, runtime registry, generated file, cache entry, or plugin-owned file can appear after the first write and be folded into the earlier approval without its own preserve / reject / retry cycle;
- partial file, DB, or plugin side effects are still unproven if any touched surface can be committed while another surface remains blocked, because old/new/blocked classification must cover the whole touched set before retry;
- stale manual-review artifacts are still unsafe if they can be reused after drift against a different row, file, relationship-bearing record, remapped create target, or plugin-owned surface; a readable artifact is audit evidence only until the live boundary is rerun with the preserved, inspectable remote and fresh live hashes; and
- Reprint `27c5f25`, ZS-Sync `d9334a0`, and ForkPress `55f9879` remain historical context only. They can justify transport framing, discovery framing, or review vocabulary, but they do not prove live push safety, preserved-remote auditability, create-time remap safety, plugin-owned surface coverage, or a fresh retry scope on this branch.
- even when one of those notes names the exact upstream state, it still does not become current retry authority unless this branch reran the same live boundary with the preserved remote, stale-authority rejection, and fresh live-hash retry scope;
- if a comparison note is the only remaining evidence, it still must name the exact live boundary, the preserved remote that stayed inspectable after rejection, and the fresh retry scope rebuilt from live hashes; otherwise the note is audit context only and cannot support production-grade wording or production-grade push support claims.

Before any production-grade wording is allowed, the evidence must name the exact live boundary, the exact stale-drift case, the preserved remote that stayed inspectable after rejection, the fresh retry scope rebuilt from live hashes, and the old/new/blocked status for every touched surface. If any late-discovered plugin-owned surface appears after the first write, it becomes a new boundary until it is separately enumerated or hard-blocked.

Must-happen-before-production-grade-push-support checklist:

- live remote drift: prove the rejected remote is still inspectable after stale authority is denied, and prove the retry scope was rebuilt from fresh live hashes rather than from the earlier plan artifact;
- identity remap on create: prove the remapped target was derived from live identity evidence at apply time, or show the remap was rejected before any write; route shape alone is not proof;
- plugin-owned surfaces outside the allowlist: enumerate late-discovered tables, blobs, cron rows, runtime registries, generated files, caches, and plugin-owned files, then either block them or give each its own preserve / reject / retry cycle;
- partial side effects: show the whole touched set classified old/new/blocked across file, DB, and plugin writes, with no surface silently succeeding while another surface is left in limbo;
- stale manual-review artifacts: prove a readable review note cannot authorize a different row, file, relationship-bearing record, remapped create target, or plugin-owned surface after drift unless the remote was preserved and the retry scope was rebuilt from live state;
- proof reuse across boundaries: prove that a later-discovered plugin-owned surface or remapped create target cannot inherit the earlier preserved remote, rejection point, or review artifact just because the route family, package mount, or reviewer wording stayed the same; if the later surface is a new boundary, the earlier artifact stays audit-only and cannot be relabeled as retry authority;
- production claims: never infer production-grade push support from lab route shape, lab-shaped route output, package layout, fixture replay, copied-executor output, or `finalMatchesLocal`; those only prove compatibility until the live boundary is rerun with preserved-remote evidence and fresh live hashes, and they do not cover a later-discovered surface that appears only after the first write.
- production claims must also name the exact boundary transition when a plugin-owned surface or remapped create target is discovered after the first write; if that discovery creates a new boundary, the earlier preserved remote and review artifact stay audit-only and cannot be reused as retry authority for the new boundary.
- production claims must not treat a lab-shaped URL, package mount, or fixture-backed route as proof that the live executor exists behind it; the shape can match while the boundary is still copied, fixture-backed, or otherwise non-live.
- production claims that mention Reprint, ZS-Sync, or ForkPress must state both what the note proves here and what it does not prove here; if that pair is missing, the note stays historical context even when the upstream commit or worktree anchor is named.
- production claims must also reject any implication that route-shaped smokes or fixture replay prove the live executor, preserved remote, stale-authority rejection, create-time remap safety, or plugin-owned surface coverage; those remain unproven until this branch reruns the same live boundary with fresh live hashes and per-surface old/new/blocked classification.

Release-gate language checklist:

- the text says historical context, compatibility evidence, or live retry proof explicitly rather than implying it;
- every comparison note names both what the upstream note proves and what it does not prove on this branch;
- no sentence turns route shape, package layout, fixture replay, or a readable review note into proof of live push safety;
- no production-grade claim is allowed unless the branch-local live boundary rerun is named together with preserved-remote evidence, stale-authority rejection, and a fresh retry scope from live hashes;
- any later-discovered row, file, relationship-bearing record, remapped create target, or plugin-owned surface is treated as a new boundary unless it is separately preserved, rejected, and retried; and
- any later-discovered plugin-owned surface or remapped create target is treated as a new boundary even when it is found inside the same route family or package mount, because the earlier preserved remote only covers the boundary that was actually rerun; and
- the gate fails closed if the proof is not branch-local, because a copied route, a copied reviewer note, or an upstream comparison cannot authorize current retry authority on this worktree; and
- if any of the above is missing, the wording stays audit-only and cannot claim production-grade push support.

Missing-proof matrix for the current design:

- live remote drift after preflight: missing proof is the exact rejection point before the first mutation, plus an inspectable preserved remote and a retry scope rebuilt from fresh live hashes on this branch;
- create-time identity remapping, aliasing, or renumbering: missing proof is live identity evidence for the remapped target at apply time, or a hard block before write; route family and fixture shape are not proof;
- plugin-owned data traps outside the allowlist: missing proof is live enumeration or explicit blocking of every hidden table, cron row, runtime registry, generated file, cache entry, serialized blob, and plugin-owned file, including surfaces discovered only after the first write;
- partial file, DB, or plugin side effects: missing proof is old/new/blocked classification for the whole touched set before retry, so a mixed commit cannot be relabeled as success after only the committed part;
- source-note comparisons: missing proof is the exact upstream state plus a rerun of the same live boundary here, with an explicit statement of what the note proves here and what it does not prove here; matching route shape, package layout, or reviewer wording only proves historical context;
- stale manual-review artifacts: missing proof is that the artifact stayed audit-only after drift, could not authorize a different row/file/remapped target/plugin surface, and was replaced by a fresh retry scope rebuilt from live hashes;
- Reprint, ZS-Sync, and ForkPress comparisons: missing proof is the exact upstream state plus a rerun of the same live boundary here, with an explicit statement of what the note proves here and what it does not prove here; matching route shape, package layout, or reviewer wording only proves historical context; and
- production-grade wording: missing proof is the same live boundary on this worktree showing preserved-remote evidence, stale-authority rejection before the first write, fresh retry scope rebuilt from live hashes, and per-surface old/new/blocked classification.
- late-discovered surfaces: missing proof is that a later row, file, relationship-bearing record, remapped create target, or plugin-owned surface was treated as a new live boundary with its own preserve / reject / retry cycle; even if the route shape, package mount, or reviewer wording matches, the earlier preserved remote and readable artifact do not carry retry authority across that boundary.
- proof reuse: missing proof is that the preserved remote, rejection point, and retry scope were rebuilt for the later boundary from live hashes on this branch instead of copied from the earlier boundary; if that later surface was not independently named old, new, or blocked before retry, the earlier artifact is still only compatibility evidence.
- same-route-family trap: missing proof is that a later plugin-owned surface or remapped create target found inside the same route family was explicitly treated as a separate live boundary; route-family reuse only proves surface similarity, not that the later boundary inherited the earlier preserved remote, rejection point, or retry scope.
- evidence classification: missing proof is an explicit label saying whether a manual-review artifact, source-note comparison, or smoke result is historical context, compatibility evidence, or live retry proof; if the wording does not name the class, it must fail closed and cannot support production wording.

False-reliability trap to keep naming explicitly:

- a readable manual-resolution note, source comparison, or review artifact is still not retry authority if the later boundary is a remapped create target, a new row/file/relationship-bearing record, or a plugin-owned surface discovered after the first write;
- the same route family, package mount, reviewer wording, or historical upstream anchor does not make that later boundary the same boundary; the earlier artifact stays audit-only until the later boundary separately preserves the remote, rejects stale authority before mutation, and rebuilds retry scope from fresh live hashes; and
- if the remote drifted after dry-run but before apply, that exact drift case must be named and the rejected remote must stay inspectable for audit/retry; otherwise the later apply is a new boundary and the earlier artifact cannot authorize it;
- if the later surface cannot be named as old, new, or blocked before retry, the branch still lacks production-grade proof even when the earlier artifact is readable and the route looks production-shaped.

Final production-grade deltas still required on this branch:

- state the live boundary, the preserved remote, the stale-rejection point, and the fresh retry scope in one place, so a reviewer can audit the exact failure case instead of inferring it from route shape or fixture replay;
- split out any late-discovered plugin-owned surface as its own boundary when it appears after the first write, and forbid it from inheriting the earlier approval even if the route family, mount, or reviewer wording matches;
- mark mixed file, DB, and plugin writes old/new/blocked across the full touched set before retry, so a partial commit cannot be recast as success after the surviving surfaces are visible;
- annotate every Reprint, ZS-Sync, or ForkPress citation with the exact upstream commit or worktree state, what it proves here, and what it does not prove here, because the notes are historical design input only unless the same live boundary was rerun on this branch;
- label every manual-review artifact and source-note comparison with its evidence class, because unlabeled wording can be mistaken for retry authority even when it is only historical context or compatibility evidence;
- require every production-ready sentence to say whether it is historical context, compatibility evidence, or live retry proof; if the sentence omits that class, it fails closed and cannot justify a production claim;
- reject any wording that uses `manual resolution`, `comparison passed`, `finalMatchesLocal`, or route-shaped smokes as current proof unless the preserved remote stayed inspectable after rejection and the retry scope was rebuilt from live hashes; and
- keep the release-gate language explicit that production-grade push support is blocked until the branch can show the live executor, preserved-remote auditability, stale-authority rejection, fresh retry scope, and per-surface classification for every touched boundary.

Production-grade release gate:

- name the exact live boundary and the exact stale-drift case before claiming push support;
- show the preserved remote stayed inspectable after rejection and cannot be reused as retry authority;
- show the fresh retry scope was rebuilt from live hashes on this branch, not copied from the first approval;
- classify every touched row, file, relationship-bearing record, and plugin-owned surface as old, new, or blocked before retry starts;
- enumerate or block any plugin-owned surface outside the allowlist, including late-discovered tables, files, cron rows, runtime registries, generated assets, caches, and serialized blobs;
- treat any later-discovered plugin-owned surface or remapped create target as a new boundary with its own preserve / reject / retry cycle; and
- keep Reprint, ZS-Sync, and ForkPress comparisons labeled as historical context unless the branch reran the same live boundary with the same drift case.

Production-ready wording gate:

- if the evidence only shows route shape, package layout, fixture replay, readable review output, or `finalMatchesLocal`, the claim stays compatibility-only;
- if the evidence does not name the exact live boundary, the stale-drift case, the preserved remote that stayed inspectable after rejection, and the fresh retry scope rebuilt from live hashes, the claim fails closed;
- if a later-discovered row, file, relationship-bearing record, remapped create target, or plugin-owned surface appears after the first write, it is a new boundary and must get its own preserve / reject / retry cycle before it can be treated as success;
- if any plugin-owned table, file, cron row, runtime registry entry, generated asset, cache entry, or serialized blob is outside the allowlist and not explicitly blocked before write, the branch does not have production-grade push proof;
- if any file, DB row, or plugin side effect survives a failed apply, the whole touched set must be labeled old, new, or blocked before retry starts; a partially successful write cannot be relabeled as success; and
- if a Reprint, ZS-Sync, or ForkPress note is cited, it must say exactly what the note proves here, what it does not prove here, and whether this branch reran the same live boundary; otherwise it remains historical context only and cannot support production wording.

## Remaining Production-Grade Gaps

The design still has not closed the following production-grade gaps:

- there is still no single executable real-site preflight/release command on
  this branch; `plan`, `apply`, and the `test:playground:*` smoke scripts are
  compatibility and lab-verification entry points only, so they cannot by
  themselves prove the live executor boundary, the auth boundary, the
  preserved remote, the stale rejection point, or the fresh retry scope on an
  actual remote; until that command exists, names the live executor and auth
  path, and can be rerun against a real remote with preserved-remote
  evidence, every production-grade push claim must fail closed;
- conflict policy is still ambiguous when the remote drifts between dry-run
  and apply; missing proof is a branch-local rejection point before the first
  write, plus an auditable preserved remote that the user can inspect and
  retry from, not a generic "manual resolution" label or a successful
  fixture replay;
- create-time identity remap is still a hidden data-loss mode if the target ID
  is aliased, renumbered, or redirected at apply time; missing proof is live
  identity evidence at the write boundary or a hard block before mutation,
  not a same-shaped fixture or route note;
- plugin-owned state outside the allowlist remains a data trap if hidden
  tables, cron rows, runtime registries, generated files, caches, or
  serialized blobs are only discovered after the first write; missing proof is
  live enumeration or apply-time blocking for every owned surface on this
  branch, including any late-discovered surface that must become its own new
  boundary;
- partial file, DB, or plugin side effects remain unreconciled if the audit
  does not classify each touched surface as old, new, or blocked before
  retry; missing proof is per-surface classification that survives mixed
  outcomes, not a final success label applied to the committed subset, and
  not a later "success" label on the subset that happened to write while the
  failed surfaces stayed unclassified;
- stale manual-review artifacts are still a false-reliability risk if they can
  be reused after drift to authorize a later row, file, relationship-bearing
  record, remapped create target, or plugin-owned surface; missing proof is
  that the artifact stays audit-only, the remote stayed inspectable after
  rejection, and the retry scope was rebuilt from fresh live hashes on this
  branch;
- that same stale artifact is also not current proof if a later-discovered
  plugin-owned surface or remapped create target appears after the first write
  but before retry; the later boundary must be named separately and cannot
  inherit the earlier preserved remote or review note just because the route
  family, package mount, or reviewer wording matches;
- "manual resolution later" is especially false reliability when the later
  boundary is a remapped create target, relationship-bearing record, or
  plugin-owned surface that was not enumerated before the first write; the
  earlier note may remain audit evidence, but it cannot become retry authority
  for a boundary that was only discovered after the write;
- "manual resolution later" is also false reliability when the first write
  succeeded only for a subset of touched surfaces and the remaining file, DB,
  relationship-bearing, or plugin-owned surfaces were discovered afterward;
  the readable note cannot upgrade that mixed outcome into success unless the
  whole touched set is reclassified old, new, or blocked and retried from
  fresh live hashes on this branch;
- a readable stale manual-review artifact is still not retry authority even
  when it survives drift intact; if the first write already committed and a
  later boundary appears, the artifact can remain audit evidence only, while
  the new row, file, relationship-bearing record, remapped target, or
  plugin-owned surface must get its own preserve / reject / retry cycle;
- comparisons to Reprint, ZS-Sync, or ForkPress still overclaim if they are
  used as proof instead of historical context; missing proof is the exact
  upstream state, what the note proves here, what it does not prove here, and
  a rerun of the same live boundary on this branch with preserved-remote,
  stale-rejection, and fresh-retry evidence; route shape, package layout,
  reviewer wording, and fixture replay stay compatibility evidence only even
  when the note is precise; and
- a route-shaped smoke or production-shaped URL still does not prove the live
  executor if the boundary was not rerun here with preserved-remote evidence
  and a fresh live-hash retry scope; the same URL can still hide a copied or
  fixture-backed executor, so route similarity is compatibility evidence only;
- any lab-shaped smoke, copied executor output, or `finalMatchesLocal` result
  is still not boundary proof unless it also shows the rejected remote stayed
  inspectable after rejection and the same live boundary was retried from
  fresh live hashes on this branch; and
- a precise upstream commit still does not become current proof if the later
  live boundary is different from the one the note described; the branch must
  rerun the same live drift case here, not merely cite the same upstream hash;
- a "manual resolution later" label is also false reliability if the readable
  artifact was preserved but the later boundary introduced a new plugin-owned
  surface, because the new surface needs its own preserve / reject / retry
  cycle before any success wording is allowed; and
- a readable approval that predates a later-discovered plugin-owned surface or
  remapped create target still cannot authorize the later boundary just because
  the route family, package mount, reviewer wording, or fixture shape matches;
  the later boundary still needs its own preserved remote, rejection point,
  and fresh retry scope rebuilt from live hashes; and
- the conservative comparison rule is:
  - Reprint notes can justify transport, staged delivery, or resumability
    vocabulary, but they do not prove a live push executor, preserved remote,
    or stale-drift rejection on this branch;
  - ZS-Sync notes can justify discovery or cursoring vocabulary, but they do
    not prove source-mutation safety, create-time remap handling, or
    plugin-owned surface coverage here; and
  - ForkPress notes can justify review or durability vocabulary, but they do
    not prove retry authority, preserved-remote auditability, old/new/blocked
    classification, or authority over a later boundary that was discovered
    after the note was written; and
- any "production-ready" or "manual resolution" wording is false reliability
  unless it names the exact drift case, the preserved remote, the rejection
  point before the first write, the fresh live-hash retry scope, and the
  old/new/blocked status for every touched surface.

Release gate for this branch:

- before any production-grade push claim, verify that the exact live boundary
  is named, the stale-drift case is named, the live executor and auth path
  are named, the preserved remote stayed inspectable after rejection, the
  rejection point happened before the first write, the fresh retry scope was
  rebuilt from live hashes, and every touched surface is classified old,
  new, or blocked;
- no production-grade push claim unless the exact drift case is named and the
  remote stayed inspectable after rejection for audit/retry;
- no production-grade push claim unless the stale approval or review artifact
  was rejected before the first write and cannot widen to a later row, file,
  relationship-bearing record, remapped create target, or plugin-owned
  surface;
- no production-grade push claim unless create-time identity remap is either
  proven safe with live identity evidence or hard-blocked before write;
- no production-grade push claim unless every touched file, DB row,
  relationship-bearing record, and plugin-owned surface is classified old,
  new, or blocked before retry starts;
- no production-grade push claim unless every plugin-owned surface outside
  the allowlist is enumerated live or blocked at apply time, including hidden
  tables, cron rows, runtime registries, generated files, caches, and
  serialized blobs;
- no production-grade push claim unless any later-discovered plugin-owned
  surface is treated as a new boundary with its own preserve / reject /
  retry cycle and not backfilled into the earlier approval;
- no production-grade push claim unless "manual resolution later" is treated
  as audit-only wording for any boundary discovered after the first write,
  including remapped create targets and plugin-owned surfaces;
- no production-grade push claim unless any comparison to Reprint,
  ZS-Sync, or ForkPress says what the note proves here, what it does not
  prove here, and whether this branch reran the same live boundary; and
- no production-grade push claim unless the evidence is live-boundary proof,
  not route shape, package mount, fixture replay, readable review output,
  lab-shaped route smoke, copied executor output, or `finalMatchesLocal`.
- no production-grade push claim unless any lab-shaped route smoke or
  fixture-shaped smoke also shows the preserved remote, the rejection point,
  and the fresh live-hash retry scope for the same boundary; otherwise the
  smoke may only be a copied or fixture-backed executor behind the same URL.
- if any item above is missing, the wording stays audit-only and cannot be
  promoted to production-grade push support.

Production-grade proof still missing on this branch:

- live remote drift is not closed until the rejected remote stays inspectable
  after rejection and the retry scope is rebuilt from fresh live hashes;
- the first real-site command is not closed until the claim can name the live
  executor and auth boundary that produced it, because a copied executor or
  fallback auth path behind the same route shape is still compatibility
  evidence only;
- a production-shaped `/wp-json/reprint/v1/push/*` smoke is not closed
  until it also proves the rejected remote stayed inspectable after stale
  drift and that any later-discovered plugin-owned surface was enumerated or
  blocked before write; route reachability alone is compatibility evidence,
  not live push proof;
- create-time identity remap is not closed until apply-time identity evidence
  exists or the remap is blocked before mutation, because matching route
  shape can still hide aliasing or renumbering;
- plugin-owned state outside the allowlist is not closed until every owned
  surface is enumerated or blocked before write, including hidden tables,
  cron rows, runtime registries, generated files, caches, serialized blobs,
  and any late-discovered surface that becomes a new boundary;
- partial file, DB, or plugin side effects are not closed until every touched
  surface is classified old, new, or blocked before retry, so mixed outcomes
  cannot be relabeled as success;
- stale manual-review artifacts are not closed until the artifact stays
  audit-only after drift, cannot be reused as retry authority for a different
  boundary, and the branch reruns the same live boundary with preserved-
  remote evidence and fresh live hashes; and
- Reprint, ZS-Sync, and ForkPress comparisons are not closed until each one
  names the exact upstream state, the exact live boundary, what the note
  proves here, and what it does not prove here.

Concise release-gate summary:

- any claim of production-grade push support still fails until the branch can
  show the exact stale-drift case, the preserved remote that remained
  inspectable after rejection, and a fresh retry scope rebuilt from live
  hashes on this worktree;
- any lab-shaped route or production-shaped URL still counts only as
  compatibility evidence, because the same shape can be served by a copied
  or fixture-backed executor instead of the live write path;
- any create-time identity remap still needs live identity evidence or a hard
  block before write, because route shape, package mount shape, and fixture
  shape are compatibility signals only;
- any plugin-owned surface outside the allowlist still needs explicit
  enumeration or blocking before write, including late-discovered hidden
  tables, cron rows, runtime registries, generated files, caches, serialized
  blobs, and plugin-owned files; and
- any partial file, DB, or plugin side effect still needs old/new/blocked
  classification for the full touched set before retry starts, so a mixed
  outcome cannot be relabeled as success.
- a stale manual-review artifact is never retry authority for a later-
  discovered plugin-owned surface or remapped create target unless that later
  boundary separately preserved the remote, rejected stale authority, and
  rebuilt retry scope from live hashes on this branch.
- an earlier readable approval, comparison note, or manual-resolution
  artifact cannot be widened to cover a second live boundary after the first
  write, even if the later boundary reuses the same route family, package
  mount, reviewer wording, or fixture shape; the later boundary must still
  prove its own preserved remote, rejection point, and fresh live-hash retry
  scope before it can be called retry authority.
- if the later boundary is a remapped create target, a late-discovered
  plugin-owned surface, or a partial file/DB/plugin side effect, the missing
  proof is still the same: the earlier artifact is audit-only until that
  later boundary has its own preserve / reject / retry cycle and old/new/
  blocked classification.

Boundary-transfer rule:

- a readable manual-review artifact or source-note comparison never carries
  authority from one live boundary to the next, even if the route family,
  package mount, or reviewer wording is unchanged;
- if a later boundary introduces a remapped create target, a late-discovered
  plugin-owned surface, or a new row/file/relationship-bearing record after
  the first write, the earlier artifact stays historical context only until
  that later boundary gets its own preserved remote, rejection point, and
  fresh retry scope rebuilt from live hashes; and
- a matching surface shape does not prove that the later boundary inherited
  the earlier retry authority.

Comparison rule:

- Reprint, ZS-Sync, and ForkPress notes remain historical context unless this
  branch reran the same live boundary with preserved-remote evidence and a
  fresh retry scope rebuilt from live hashes; matching route family,
  package mount, or reviewer wording is not enough to promote the note to
  current proof.
- the same rule applies to any later-discovered row, file,
  relationship-bearing record, remapped create target, or plugin-owned
  surface: if that later boundary was not independently rerun here with its
  own preserved remote, rejection point, and fresh retry scope rebuilt from
  live hashes, the earlier Reprint, ZS-Sync, or ForkPress comparison stays
  historical context for the earlier boundary only, even when the route or
  reviewer wording is identical.
- a later-discovered plugin-owned surface or remapped create target is a new
  boundary even if the route family, package mount, reviewer wording, or
  fixture shape matches a prior boundary; without its own preserved remote
  and rejection point, the prior note cannot be widened into retry authority.

Production-grade wording still needs explicit proof for these failure modes:

- live remote drift between dry-run and apply: the evidence must show the
  exact rejection point before the first write, the preserved remote that
  stayed inspectable after rejection, and the fresh retry scope rebuilt from
  live hashes on this branch;
- create-time identity remap or aliasing: the evidence must show live
  identity at the write boundary, or the remap must be hard-blocked before
  mutation; route shape, package mount, and fixture shape are compatibility
  signals only;
- plugin-owned data traps outside the allowlist: the evidence must enumerate
  or block hidden tables, cron rows, runtime registries, generated files,
  caches, serialized blobs, and plugin-owned files before write, including
  surfaces discovered only after the first write;
- partial file, DB, or plugin side effects: the whole touched set must be
  classified old, new, or blocked before retry starts, so a mixed write
  cannot be relabeled as success after only the committed subset; and
- stale manual-review artifacts: any readable artifact stays audit evidence
  only unless the same live boundary preserved the remote, rejected stale
  authority before the first write, and rebuilt retry scope from live hashes;
  a later-discovered row, file, relationship-bearing record, remapped create
  target, or plugin-owned surface must get its own preserve / reject / retry
  cycle and cannot inherit the earlier note.

Must-happen-before-production-grade wording:

- live remote drift between dry-run and apply must be rerun on this branch
  with the rejected remote still inspectable after rejection, a named
  rejection point before the first write, and a retry scope rebuilt from
  fresh live hashes; a readable manual-resolution note is audit evidence
  only, not proof;
- create-time identity remapping, aliasing, or renumbering must either be
  proven with live identity evidence at apply time or hard-blocked before
  mutation; route shape, package mount, and fixture shape are only
  compatibility evidence;
- plugin-owned state outside the allowlist, including hidden tables, cron
  rows, runtime registries, generated files, caches, serialized blobs, and
  plugin-owned files, must be enumerated or blocked before write, and any
  surface discovered after the first write must become a new boundary with
  its own preserve / reject / retry cycle;
- partial file, DB, or plugin side effects must be classified old, new, or
  blocked for the whole touched set before retry starts, so a mixed outcome
  cannot be relabeled as success after only the committed subset; and
- comparisons to Reprint, ZS-Sync, or ForkPress must name the exact
  upstream revision or worktree state, say what the note proves here, say
  what it does not prove here, and still rerun the same live boundary on
  this branch; route family, package mount, reviewer wording, and fixture
  replay are not current proof, and those notes still do not prove
  preserved-remote safety, production auth/session lifecycle, recovery-
  journal durability, graph identity, or plugin-driver coverage.

Conservative comparison summary:

- Reprint `27c5f25` supports staged transport, resumability vocabulary, and
  chunked delivery framing only;
- ZS-Sync `d9334a0` supports bounded discovery, cursoring, and batched
  resource selection only; and
- ForkPress `55f9879` supports merge-audit vocabulary and crash-consistency
  intent only.

None of those notes proves live push safety on this branch, preserved-remote
retention after rejection, stale-authority rejection before the first write,
create-time remap safety, plugin-owned surface coverage, or a fresh retry
scope rebuilt from live hashes. If a production-grade claim lacks those
branch-local proofs, the claim must fail closed.

Release-gate wording also needs to stay explicit about what is not proof:

- route shape, package layout, fixture replay, readable review output, and
  `finalMatchesLocal` are compatibility evidence only, even when they look
  production-shaped;
- a source-note comparison is historical context unless it names the exact
  upstream revision or worktree state, says what the note proves here, says
  what it does not prove here, and is rerun against the same live boundary on
  this branch; the observed anchors in `docs/source-notes.md`
  (`27c5f25`, `d9334a0`, `55f9879`) are provenance only, not retry
  authority; and
- "manual resolution" is not success unless the preserved remote stayed
  inspectable after rejection, the stale artifact was rejected before the
  first write, the fresh retry scope was rebuilt from live hashes, and every
  touched surface was classified old, new, or blocked.
- a fresh-looking manual-resolution note or comparison summary is still not
  live proof if it cannot name the exact rejected boundary, the preserved
  remote for that boundary, and the live rerun that rebuilt retry scope from
  fresh hashes on this branch.
- a later-discovered plugin-owned surface or remapped create target does not
  inherit retry authority just because it lives in the same route family,
  package mount, or reviewer note as the earlier boundary; the earlier
  artifact stays audit-only until the later boundary separately preserves the
  remote, rejects stale authority, and rebuilds retry scope from live hashes.

Comparison release gate:

- Reprint comparisons must be limited to staged pull, resumability, and
  transport vocabulary; here they support only transport framing and do not
  prove live push safety, preserved-remote retention, stale-drift rejection,
  or any later row/file/plugin boundary on this branch.
- ZS-Sync comparisons must be limited to bounded scanning and resource
  discovery vocabulary; here they support only change-discovery framing and
  do not prove source mutation safety, plugin ownership enumeration,
  create-time remap handling, or late-discovered surface coverage on this
  branch.
- ForkPress comparisons must be limited to audit and crash-consistency
  vocabulary; here they support only review and durability framing and do not
  prove that a readable review artifact can become retry authority for a
  later row, file, remapped create target, or plugin-owned surface on this
  branch.
- any comparison to Reprint, ZS-Sync, or ForkPress that omits the exact
  upstream state, the exact live boundary, what the note proves here, what it
  does not prove here, and the rerun status on this branch must fail closed,
  even if the route family, package layout, or reviewer wording matches the
  production path.
- any note that says "comparison passed", "manual resolution succeeded", or
  "production-ready" still has to name the preserved remote, the rejection
  point, and the live rerun on this branch; otherwise it remains audit-only
  and cannot be promoted to retry authority.
- the observed anchors `27c5f25`, `d9334a0`, and `55f9879` are provenance
  only; if this branch did not rerun the same live boundary with preserved-
  remote evidence and a fresh retry scope, those anchors cannot be promoted
  into retry authority, even when the route family or reviewer wording looks
  identical.
- any Reprint, ZS-Sync, or ForkPress note described only as historical
  context, compatibility evidence, or design lineage must stay in that class
  unless this branch reran the same live boundary with preserved remote
  evidence, stale rejection before the first write, and a fresh retry scope
  rebuilt from live hashes; route-family or reviewer-wording similarity does
  not promote it to live retry proof.

Concrete production-grade blockers to keep naming:

- live remote drift after dry-run: missing proof is the exact rejection point
  before the first write, the preserved remote that stayed inspectable after
  rejection, and a retry scope rebuilt from fresh live hashes on this branch;
- create-time identity remapping, aliasing, or renumbering: missing proof is
  live identity evidence for the remapped target at apply time, or a hard
  block before write; route family, package mount, and fixture shape are not
  proof;
- plugin-owned data traps outside the allowlist: missing proof is live
  enumeration or explicit blocking of every hidden table, cron row, runtime
  registry, generated file, cache entry, serialized blob, and plugin-owned
  file, including surfaces discovered only after the first write; and
- partial file, DB, or plugin side effects: missing proof is old/new/blocked
  classification for the whole touched set before retry, so a mixed write
  cannot be relabeled as success after only the committed subset.

Release gate for production-grade wording:

- the claim names the exact live boundary, the exact stale-drift case, and the
  rejection point before the first write;
- the claim names the preserved remote that stayed inspectable after
  rejection, and that remote is still audit evidence only until a fresh retry
  scope is rebuilt from live hashes on this branch;
- the claim names every touched row, file, relationship-bearing record, and
  plugin-owned surface, with each one classified old, new, or blocked before
  retry starts;
- the claim explicitly blocks or enumerates every plugin-owned surface outside
  the allowlist, including hidden tables, cron rows, runtime registries,
  generated files, cache entries, serialized blobs, and plugin-owned files;
- the claim treats any later-discovered plugin-owned surface or remapped
  create target as a separate live boundary unless it already had its own
  preserve / reject / retry cycle before the first write;
- the claim distinguishes provenance from proof for every Reprint, ZS-Sync,
  or ForkPress citation: the upstream anchor may explain why the design
  exists, but it never authorizes this branch unless the same live boundary
  reran here with preserved-remote evidence and a fresh retry scope; and
- any route or smoke that reports `labBacked: true` remains compatibility
  evidence even when the command or script name is `authenticated`,
  `production-shaped`, or `production-plugin-package`; that flag means the
  executor still resolves to lab-backed Playground internals, so it cannot be
  used as proof of production auth/session lifecycle, preserved-remote
  safety, or release-ready push support; and
- the claim says what each source note proves here and what it does not prove
  here, so Reprint, ZS-Sync, and ForkPress stay provenance unless this branch
  reran the same live boundary with fresh live hashes; and
- the claim rejects any `finalMatchesLocal`, route-shaped smoke, production-
  shaped URL, or readable manual-resolution note as production proof unless
  it is paired with the same live boundary, the preserved remote that stayed
  inspectable after rejection, the exact rejection point before the first
  write, and the fresh retry scope rebuilt from live hashes on this branch;
  and
- the claim rejects stale manual-review artifacts, older review comments, and
  comparison notes as retry authority unless the same live boundary was rerun
  here and the artifact still names the preserved remote, rejection point,
  and fresh retry scope for that exact boundary; and
- the claim rejects "manual resolution", "comparison passed", and
  "production-ready" as success labels unless the live rerun, preserved remote,
  rejection point, and per-surface classification are all present together.
- a fresh-looking manual-resolution note from a later rerun is still audit
  evidence only unless it names the exact rejected boundary, the preserved
  remote that stayed inspectable after rejection, and the fresh retry scope
  rebuilt from live hashes on this branch; polished wording cannot widen the
  earlier boundary or absorb a later-discovered plugin-owned surface.

Use `audits/critic-release-gate.md` as the compact preflight checklist for
these requirements before any wording is promoted.

Primary finding for this iteration: the branch still does not have a named
real-site preflight/release command that can be rerun against a live remote
and prove preserved-remote behavior on the rejected boundary. Until that
exists, production-grade wording is blocked no matter how production-shaped
the smoke route, review artifact, or command name looks.

Do not let the branch claim production-grade push support until all of these
are true on this worktree:

- the primary blocker is the absence of a named real-site preflight/release
  command; if this branch only has lab or compatibility flows, production
  wording must fail closed regardless of route shape, smoke naming, or
  review-artifact polish;
- the branch names one real-site preflight/release command that can be rerun
  against an actual remote and whose output alone proves the exact command
  string, the rejected remote stayed inspectable, the rejection point
  happened before the first write, and the retry scope was rebuilt from live
  hashes; if the proof still comes only from `plan`, `apply`,
  `test:playground:*`, route-smoke output, or source-note comparison, the
  claim is still lab-only;
- a command name that sounds real-site but still resolves to the playground
  or lab executor cannot be promoted into release proof, even if it reaches a
  remote-like URL or matches the expected route family; the executor identity
  and preserved-remote evidence still have to be proven on the live boundary;
- any script branded `production-shaped`, `authenticated`, or
  `production-plugin-package` is still just a smoke unless it reruns the same
  live boundary on an actual remote and preserves the rejected remote for
  audit; a production-sounding name does not create production proof;
- the branch has a single executable preflight/release command that can be
  run against a real remote on this branch, and its output proves the exact
  live boundary, preserved remote, stale rejection point, and fresh retry
  scope end to end; if the only available commands are `plan`, `apply`, or
  `test:playground:*`, the branch is still lab-only and cannot claim
  production-grade push support;
- the next acceptable proof from reliable-executor is a live rerun against a
  real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that prints the
  executor identity, the preserved remote that stayed inspectable after
  rejection, and the exact rejection point before the first write; a wrapper
  that only reuses the playground or fixture-backed boundary is still
  compatibility evidence, not release proof;
- that command must be a real-site entry point, not just a production-
  sounding wrapper around `plan`, `apply`, or a playground smoke; command
  naming alone never proves the live executor boundary, preserved remote, or
  retry authority;
- that command must itself perform the live preflight/release path on an
  actual remote; a thin wrapper around `plan`, `apply`, or a smoke script is
  still compatibility evidence unless it records the first executor/auth/
  preserved-remote boundary and leaves the rejected remote inspectable for
  audit and retry;
- the exact stale-drift case has been rerun here, with the rejected remote
  still inspectable after rejection and the rejection point named before the
  first write;
- create-time identity remap, aliasing, or renumbering is either proven with
  live apply-time identity evidence or hard-blocked before mutation;
- every plugin-owned surface outside the allowlist has been enumerated or
  blocked before write, including late-discovered tables, cron rows, runtime
  registries, generated files, caches, serialized blobs, and plugin-owned
  files;
- every touched row, file, relationship-bearing record, and plugin-owned
  surface has been classified old, new, or blocked before retry starts, so a
  partial file, DB, or plugin side effect cannot be relabeled as success; and
- each Reprint, ZS-Sync, and ForkPress citation names the exact upstream
  state, says what it proves here, says what it does not prove here, and is
  backed by a branch-local rerun of the same live boundary.

Lead finding for the current release-proof claim:

- `npm run test:playground:production-shaped-release-proof` remains a proof
  wrapper, because there is no matching real script entry in `package.json`
  here and no rerun against a live local, Playground, or Docker
  `REPRINT_PUSH_SOURCE_URL`; the next acceptable evidence must be one exact
  command string, one exact live source URL, one preserved remote that stayed
  inspectable after rejection, one apply-time revalidation on that same
  boundary, one journal/recovery inspect step that justifies retry scope, and
  one auth/session boundary record before the first write.
- if that rerun cannot print the exact executor identity, the rejected remote,
  and the live source URL in the same run, then the claim is still setup-only
  and production wording must fail closed; a wrapper name plus lab-shaped
  output is not production proof.
- production-grade push support is still blocked until one exact executable
  command, one exact live source URL, and one preserved remote can be shown in
  the same rerun together with apply-time revalidation, journal/recovery
  inspection, auth/session boundary capture, graph-identity evidence, and
  plugin-owned surface classification; any missing item means the branch has
  not yet proven the exact retry boundary and must not use production-ready
  wording.

Exact next proof required from `25c4ef54`:

- rerun `npm run test:playground:production-shaped-release-verify` against one
  live local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, and treat that
  rerun itself as the proof command rather than as a wrapper label or setup
  placeholder;
- print the executor identity and auth/session boundary before the first
  write;
- preserve the rejected remote so it remains inspectable after rejection;
- show the exact rejection point before the first write;
- show apply-time revalidation on that same live boundary;
- inspect the journal and recovery state that defines retry scope;
- classify every touched row, file, relationship-bearing record, and
  plugin-owned surface old, new, or blocked before retry starts; and
- separately preserve, reject, and retry any later-discovered plugin-owned
  surface or remapped create target instead of widening the earlier proof.

If the rerun cannot produce those facts from one executable command on one
live source URL, the claim stays compatibility-only and no production-grade
wording is allowed.
