# Critic Release Gate

This note is a compact checklist for any wording that might claim production-grade push support.

Required proof artifacts on the same live boundary:

- the exact executable command string and exact live `REPRINT_PUSH_SOURCE_URL`;
- the executor identity and live auth/session boundary before the first write;
- the preserved remote that stayed inspectable after rejection;
- the exact rejection point before the first write;
- dry-run receipt, apply-time revalidation, and journal/recovery inspection;
- graph identity and plugin-driver coverage on the live boundary; and
- old/new/blocked classification for every touched row, file, relationship-bearing record, and plugin-owned surface before retry starts.

Conflict handling must also be explicit:

- a drifted row, file, relationship-bearing record, or plugin-owned surface must
  be classified as rejected, preserved, or queued for a new retry scope before
  the next write;
- "manual resolution" is not a success label unless the preserved remote stays
  inspectable and the same boundary can be audited and retried from fresh live
  hashes; and
- any later-discovered plugin-owned surface or remapped create target gets its
  own preserve / reject / retry cycle instead of inheriting the first approval.

If any claim cannot name all of those artifacts for the same rerunnable live boundary, it is compatibility evidence only and must not be phrased as production-grade push support.

Do not use production wording unless the branch has all of the following for the same live mutation boundary on this worktree:

- commit `2b00b189` is not treated as proof until a live real-site command,
  not a wrapper label, has been rerun against a real local, Playground, or
  Docker `REPRINT_PUSH_SOURCE_URL` and has printed the executor identity, the
  preserved remote that stayed inspectable after rejection, the exact
  rejection point before the first write, and the journal/recovery inspection
  needed to audit retry scope;
- commit `3089aee2` and a completed `npm run verify:release` run are
  retained-source evidence on this baseline, but they still do not satisfy
  production proof until the same branch shows live WordPress auth/session
  lifecycle, durable journal semantics, graph identity, and plugin-driver
  coverage on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`;
- `REPRINT_PUSH_SOURCE_URL` is supplied from a real local, Playground, or Docker source and is used by a live preflight/release command, not just a setup placeholder;
- the claimed `npm run test:playground:production-shaped-release-proof` command is not a proof command at all if it is absent from `package.json`; if it exists only as a discussion label or wrapper around other playground scripts, it remains compatibility evidence only;
- a completed `npm run verify:release` run is still local lab evidence unless the same branch also proves the live WordPress auth/session lifecycle, durable journal semantics, preserved-remote auditability, and apply-time revalidation on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`;
- a single executable real-site preflight/release command is named and can be rerun on demand; this repo currently exposes only `plan`, `apply`, `test`, and a larger set of `test:playground:*` and `test:recovery:*` compatibility scripts in `package.json`, including `test:playground:authenticated-http-push`, `test:playground:authenticated-cli-push`, `test:playground:production-shaped-push`, `test:playground:production-plugin-package`, `test:playground:push-protocol`, `test:playground:recovery`, and the db-journal/storage-guarded variants, so those scripts remain compatibility checks only unless one of them is explicitly promoted into the real-site release command and proves the live boundary end to end on an actual remote;
- if a command name sounds real-site but still resolves to the playground or lab executor, it is still compatibility evidence only; remote-like URL shape does not make a Playground executor a release command, and it does not prove preserved-remote auditability;
- if the repo only exposes lab and playground entry points (`plan`, `apply`, `test:playground:*`, and related `test:recovery:*` helpers), production wording must fail closed until a named real-site release command exists, can be rerun on an actual remote, and produces preserved-remote evidence for the rejected boundary;
- if the branch has not yet shown the exact first executor/auth/preserved-remote boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, then production wording must also fail closed on production auth/session lifecycle, recovery-journal durability, graph identity, and plugin-driver coverage; those are not implied by route shape, script naming, or review wording;
- if the branch has only shown local retained-source evidence, route-shape compatibility, or a named smoke such as `verify:release` without the live executor/auth/preserved-remote boundary, then it has not proven production push support and must not claim production-grade wording;
- if the proof only shows a wrapper label, route-shaped smoke, or source-note comparison without the exact live boundary and preserved remote, it is still compatibility evidence only;
- if no branch-local command has yet been run against a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, then the branch has not proven the first executor/auth/preserved-remote boundary and every production-grade claim must stay blocked;
- if a claim points to `npm run test:playground:production-shaped-release-proof` or any similarly named wrapper without a matching `package.json` entry and a rerun against a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, treat that claim as setup-only and fail closed;
- if a later plugin-owned surface appears after the first write, the earlier approval does not cover it unless the boundary separately preserved the remote, rejected stale authority, and rebuilt retry scope from fresh live hashes for that later surface;
- the next acceptable proof from reliable-executor must be a live rerun against a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that records the exact executable command string, the executor identity, the preserved remote that remained inspectable after rejection, the exact rejection point before the first write, and the journal/recovery inspection needed to audit retry scope; without those facts from one rerun, the branch still has compatibility evidence only;
- the next proof must name the exact executable command string that produced those facts; if the evidence is only a wrapper around setup, a route-shaped smoke, or a review note, it does not count as a live rerun of the boundary;
- if the claim cannot name the exact command string and the exact live source URL in the same sentence, it has not identified a rerunnable release gate and must not be described as production-ready;
- if the next proof does not also show apply-time revalidation and a journal/recovery inspect step on that same live boundary, it is still missing the audit trail needed to justify preserved-remote and retry-scope claims;
- if there is no named real-site release command yet, that missing command is the primary blocker; lab-shaped success cannot be promoted into production wording by route shape, fixture replay, or review-artifact polish;
- if a smoke script is named `production-shaped`, `authenticated`, `authenticated-cli-push`, `authenticated-http-push`, or `production-plugin-package` while the repo still lacks a named real-site release command, that label is false reliability unless the script itself reruns the exact live boundary on an actual remote and preserves the rejected remote for audit;
- if that smoke also reports `labBacked: true`, the label is compatibility evidence only and cannot be read as a production executor, production auth/session lifecycle proof, or preserved-remote proof;
- if a smoke script, production-shaped route, or review artifact is described as "the release command" while the repo still lacks a named real-site entry point, that is false reliability and must be rejected as a proof gap, not accepted as operational coverage;
- any comparison to Reprint, ZS-Sync, or ForkPress is provenance only unless it names the exact upstream revision or worktree state, says what it proves here, says what it does not prove here, and is backed by a branch-local rerun of the same live boundary; those notes do not prove preserved-remote safety, production auth/session lifecycle, recovery-journal durability, graph identity, or plugin-driver coverage on this branch, and wording alone never upgrades them to retry authority;
- if the supervised reliable-executor lane reports `authSessionType`, minted session shape, `applyCommitted`, or `durableJournal.rows: 17` at remote head `68664884` or earlier retained-source point `63a3502f`, treat that as retained-source lab evidence only; it may validate the retained-source harness, but it still does not become branch-local live retry proof until this worktree reruns the same boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` and preserves the rejected remote for audit;
- even a correct upstream anchor is still only provenance if the branch does not rerun the same live boundary on this worktree and preserve the rejected remote for audit; the note must say what it proves here and what it does not prove here, or it stays ambiguous and cannot authorize production wording;
- the exact stale-drift case is named and rerun here, not inferred from a route-shaped smoke, fixture replay, or copied mount;
- the remote that drifted is preserved, still inspectable after rejection, and treated as audit evidence only until a fresh retry scope is rebuilt from live hashes on this branch;
- the stale approval or review artifact is rejected before the first write and cannot become retry authority for any later row, file, relationship-bearing record, remapped create target, or plugin-owned surface;
- the first real executor/auth/preserved-remote boundary is recorded by the live preflight command itself, not inferred from a smoke label, env placeholder, or review note;
- every touched row, file, relationship-bearing record, and plugin-owned surface is classified old, new, or blocked before retry starts, so mixed file/DB/plugin side effects cannot be relabeled as success; and
- any later-discovered plugin-owned surface or remapped create target is a new live boundary unless it was already enumerated before write and separately preserved, rejected, and retried.

False-reliability traps to reject:

- a source-note comparison is not proof unless it names the exact upstream revision or worktree state, states what it proves here, states what it does not prove here, and is backed by a branch-local rerun of the same live boundary;
- a manual-resolution note is not success unless the remote stayed inspectable after rejection, the stale approval was rejected before the first write, and the retry scope was rebuilt from live hashes;
- a later-discovered plugin-owned surface cannot inherit the earlier approval, even if the route family, package mount, or reviewer wording matches; and
- a production-sounding script name is not a release command unless the command itself proves the live boundary on an actual remote.

Evidence classes:

- compatibility evidence includes route shape, package-mount shape, fixture replay, `finalMatchesLocal`, and production-sounding script names; none of those prove live retry authority by themselves;
- historical context includes Reprint, ZS-Sync, and ForkPress notes unless the branch reran the same live boundary here and preserved the rejected remote for audit;
- live retry proof requires the actual real-site command, the exact rejection point before the first write, preserved-remote auditability after rejection, and old/new/blocked classification for every touched surface before retry starts; and
- if a claim cannot name its evidence class, it must fail closed instead of borrowing authority from a smoke, review artifact, or source note.

Source-note comparisons remain provenance only:

- Reprint, ZS-Sync, and ForkPress notes can justify transport, discovery, or review vocabulary, but they do not prove this branch preserved the rejected remote, rejected stale authority before the first write, or rebuilt retry scope from live hashes on the same live boundary;
- a comparison note must state the exact upstream revision or worktree state, what it proves here, and what it does not prove here, or it is ambiguous and cannot authorize production wording;
- if the only evidence is route shape, package-mount shape, fixture replay, `finalMatchesLocal`, a readable review artifact, or a retained-source `verify:release` run, the claim is compatibility evidence only and must not be worded as production-grade push support; and
- a later-discovered plugin-owned surface or remapped create target never inherits retry authority from a source note or earlier approval unless that later boundary itself was separately preserved, rejected, and retried on this branch.

- the exact stale-drift case is named;
- the remote that drifted is preserved and still inspectable after rejection, and that preserved remote stays audit evidence only until a fresh retry scope is rebuilt from live hashes on this branch;
- the stale approval or review artifact is rejected before the first write and cannot become retry authority;
- the exact rejection point before the first write is named, so a reviewer can see where stale authority stopped and live retry began;
- any later-discovered plugin-owned surface, remapped create target, or mixed file/DB/plugin side effect is treated as a new live boundary unless it was already enumerated before write and separately classified old, new, or blocked;
- any late-discovered plugin-owned surface or remapped create target that appears after the first write is blocked from inheriting the earlier preserve/reject/retry cycle, even if the route family, package mount, reviewer wording, or fixture shape matches;
- any later-discovered plugin-owned surface that appears after the first write is treated as a separate live boundary even if the preserved remote, route family, package mount, or reviewer wording looks identical to the earlier one;
- any later-discovered plugin-owned surface or remapped create target is a new live boundary even when the route family, package mount, reviewer wording, or fixture shape matches a prior approval; the earlier artifact stays audit-only until the later boundary gets its own preserved remote and rejection point;
- any route-family, package-mount, reviewer-wording, or fixture-shape match only proves surface similarity; it does not transfer retry authority to a later boundary unless that later boundary was rerun here with its own preserved remote, rejection point, and fresh live-hash retry scope;
- any stale manual-review artifact remains audit-only after drift and cannot be reused against a different row, file, relationship-bearing record, remapped create target, or plugin-owned surface;
- any manual-resolution note remains audit-only after drift unless the same live boundary on this worktree preserved an inspectable remote, rejected stale authority before the first write, and rebuilt retry scope from live hashes so the user can safely audit and retry; the note is not success by itself and cannot widen to a later-discovered row, file, relationship-bearing record, remapped create target, or plugin-owned surface without a separate preserve / reject / retry cycle;
- any readable approval that predates a later-discovered plugin-owned surface or remapped create target stays audit-only even if the route family, package mount, reviewer wording, or fixture shape repeats, because the later boundary still needs its own preserved remote and rejection point;
- any source-note comparison to Reprint, ZS-Sync, or ForkPress is provenance only unless it names the exact upstream state, the exact live boundary, what the note proves here, what it does not prove here, and the branch-local rerun status; shape similarity alone must not promote it to retry authority;
- the preserved remote must remain auditable for the rejected boundary specifically, not as a generic success artifact, so a later boundary cannot borrow it as retry authority just because the route family, package mount, or reviewer wording stayed the same;
- a later-discovered row, file, relationship-bearing record, remapped create target, or plugin-owned surface cannot be absorbed into an earlier manual-resolution note just because the preserved remote is still inspectable; if that later boundary was not enumerated before write, it needs its own preserve / reject / retry cycle or a hard block;
- any wording that says "comparison passed", "manual resolution succeeded", or "production-ready" without naming the preserved remote and the boundary that was rejected before write is false reliability and must fail closed;
- any manual-review artifact that looks fresh after rerun is still audit-only unless it names the rejected boundary, the preserved remote for that boundary, and the fresh live-hash retry scope on this branch; a polished note cannot hide a second boundary, a remapped create target, or a late plugin-owned surface that was not part of the original preserve / reject / retry cycle;
- any stale manual-review artifact cannot become retry authority for a later-discovered plugin-owned surface that appears only after the first write, even if the later surface looks like the earlier one;
- any stale manual-review artifact cannot become retry authority for a remapped create target or later-discovered plugin-owned surface that appears only after the first write, even if the later boundary reuses the same route family, package mount, or reviewer wording;
- any stale manual-review artifact cannot be widened to a later boundary just because the route family, package mount, or reviewer wording stayed the same;
- any later boundary that reuses the same route family, package mount, or reviewer wording is still a fresh live boundary and must have its own preserved remote, stale-artifact rejection, and retry scope rebuilt from live hashes;
- any later-discovered plugin-owned surface or remapped create target that appears after the first write must be named as a new boundary, not as a continuation of the earlier approval;
- the fresh retry artifact is rebuilt from live hashes on this branch, not inherited from the earlier approval;
- every touched row, file, relationship-bearing record, and plugin-owned surface is classified as old, new, or blocked before retry starts;
- any surviving partial file, DB, or plugin side effect remains separately auditable and cannot be treated as success until the next retry scope is rebuilt from live hashes;
- any late-discovered plugin-owned surface is separately blocked or classified, not folded into the earlier success story;
- any partial file, DB, or plugin side effect is durably classified before retry so a mixed write cannot be relabeled as success; and
- any manual-resolution note, route-shaped smoke, production-shaped URL, fixture replay, or `finalMatchesLocal` result is treated as compatibility evidence only unless it is paired with the preserved remote, the rejection point, the stale-artifact rejection, the fresh retry artifact rebuilt from live hashes, and the same live boundary on this worktree;
- any route-shaped smoke or production-shaped URL can still come from a copied or fixture-backed executor, so it must also name the live executor boundary that produced it; without that, the result is compatibility evidence only;
- any lab fixture, copied executor, or production-shaped route smoke can still preserve the wrong remote, skip a hidden plugin-owned surface, or replay stale approval, so a matching URL or mount shape is compatibility evidence only and never proof of live push safety;
- any claim that "comparison passed" or "manual resolution succeeded" must also name the exact upstream revision or worktree state, the exact stale-drift case, the preserved remote, and the rejection point before the first write;
- a matching route family, package mount, production-shaped URL, or lab fixture route can still be served by a copied or fixture-backed executor, so route shape is compatibility evidence only and never proof of the live write boundary or production safety by itself;
- a lab-shaped route smoke or fixture-shaped smoke can still be served by a copied or fixture-backed executor behind the same URL, so it remains compatibility evidence only unless it also names the preserved remote, the rejection point, and the fresh retry scope for the same boundary;
- any source-note comparison to Reprint, ZS-Sync, or ForkPress is historical context only unless it names the exact upstream revision or worktree state, says what the note supports here, says what it does not support here, and the same live boundary was rerun on this branch; use the observed anchors from `docs/source-notes.md` (`27c5f25`, `d9334a0`, `55f9879`) as provenance only, because the note still cannot become current retry authority without preserved-remote evidence and a fresh live-hash retry scope;
- any source-note comparison must label itself explicitly as historical context, compatibility evidence, or live retry proof; if it does not say which class it is, it fails closed and cannot be used for production wording;
- any manual-review artifact must likewise label itself as historical context, compatibility evidence, or live retry proof; unlabeled wording is audit-only and cannot become retry authority;
- any source-note comparison that only proves route shape, package mount shape, production-shaped URL, reviewer wording, or fixture replay stays compatibility evidence only, even if it names the upstream revision; and
- any precise source-note comparison still fails as retry authority unless this branch reran the same live boundary with preserved-remote evidence, stale-authority rejection before the first write, and a fresh retry scope rebuilt from live hashes;
- even when the exact upstream revision or worktree state is named, the comparison still remains historical context unless this branch reran the same live boundary with the preserved remote, stale-authority rejection, and fresh live-hash retry scope;
- any source-note comparison that only matches route family, package mount, or reviewer wording is compatibility evidence only, even if the note is otherwise well formed;
- any source-note comparison that merely matches the same route family, package layout, reviewer wording, or production-shaped route name is still historical context only and cannot be treated as live proof of retry authority, preserved-remote safety, stale-authority rejection, or live write coverage; and
- any Reprint, ZS-Sync, or ForkPress citation that does not state what it proves here and what it does not prove here is ambiguous and must fail closed, even if the anchor commit is named; and
- any Reprint, ZS-Sync, or ForkPress note described only as historical context, compatibility evidence, or design lineage must remain in that class unless this branch reran the same live boundary with preserved-remote evidence, stale rejection before the first write, and a fresh retry scope rebuilt from live hashes; route-family or reviewer-wording similarity does not promote it to live retry proof; and
- any claim of "production-grade push support" is rejected unless the same live boundary shows preserved-remote evidence, stale-authority rejection, fresh retry scope rebuilt from live hashes, and per-surface old/new/blocked classification for every touched surface, including any late-discovered plugin-owned surface; and
- any claim that a readable artifact, route-shaped smoke, or comparison note is enough after drift must fail closed unless the remote stayed preserved, the stale approval was rejected before the first write, and the fresh retry scope was rebuilt from live hashes for the same boundary; and
- any late-discovered plugin-owned surface that appears only after the first write is treated as a new boundary until it is separately rejected or classified, with its own preserved remote and fresh retry scope; and
- any preserved remote or review note that predates a late-discovered plugin-owned surface cannot be widened to cover that later boundary, even if the later surface is only discovered after the first write and seems shape-compatible with the earlier one; and
- any later-discovered plugin-owned surface or remapped create target cannot inherit the earlier preserved remote or review note just because the route family, package mount, or reviewer wording matches; the earlier artifact stays audit-only until the later boundary gets its own preserve / reject / retry cycle; and
- any remapped create target discovered during retry is treated as a new boundary until it is separately preserved, rejected, and retried with fresh live hashes; and
- proof for one live boundary does not transfer to a later row, file, relationship-bearing record, remapped create target, or plugin-owned surface just because the route family, package mount, reviewer wording, or comparison note is the same; the later boundary still needs its own preserved remote, stale-artifact rejection, and fresh retry scope rebuilt from live hashes; and
- any plugin-owned data trap outside the allowlist, including hidden options, serialized blobs, generated files, caches, cron rows, or runtime registries, is treated as a live boundary only if it is enumerated before write; otherwise it is blocked, because a post-write discovery cannot be widened back into the earlier approval; and
- any surviving partial file, DB, or plugin side effect from the earlier boundary stays audit-only until the next retry scope is rebuilt from fresh live hashes; and
- any claim that a historical Reprint, ZS-Sync, or ForkPress note proves a later live boundary must fail closed unless the note names the exact upstream state, says what it supports here, says what it does not support here, and the same live boundary was rerun on this branch; and
- proof for one live boundary does not transfer to a later row, file, relationship-bearing record, remapped create target, or plugin-owned surface, even if the route family, package mount, fixture replay, or reviewer wording is the same; and
- any partial file, DB, or plugin side effect is classified before retry so mixed writes cannot be relabeled as success; and
- any claim that "manual resolution" succeeded without the preserved remote, the rejection point, and a fresh retry artifact rebuilt from live hashes for the same live boundary is false reliability, not success; the phrase is audit-only until the branch can show the exact stale-drift case, the preserved remote that stayed inspectable, and the same boundary retried from fresh live hashes;
- any claim that sounds like success but does not name the rejection point, preserved remote, fresh retry scope, and old/new/blocked surface classification must fail closed;
- any claim that "manual resolution" succeeded is also false reliability if the first write committed but a later plugin-owned surface was discovered afterwards and never got its own preserve/reject/retry cycle for that later boundary, even if the earlier readable artifact still looks valid;
- any claim that "manual resolution" succeeded is also false reliability if the first write committed but a later remapped create target, row, file, or relationship-bearing record was discovered afterwards and never got its own preserve/reject/retry cycle for that later boundary, even if the earlier readable artifact still looks valid;
- proof for one live boundary is not transferable to a later boundary, even if
  the route family, package mount, fixture replay, or reviewer wording is the
  same; the later row, file, relationship-bearing record, remapped create
  target, or plugin-owned surface still needs its own preserved remote,
  rejection point, and fresh retry artifact rebuilt from live hashes.
- any fresh-looking review note, comparison summary, or manual-resolution
  artifact stays audit-only unless it names the rejected boundary, the
  preserved remote for that boundary, and the branch-local live rerun; a
  polished note cannot retroactively authorize a later boundary.
- a source-note comparison is only historical context unless it names the exact upstream state, states what it proves here, states what it does not prove here, and this branch reran the same live boundary; the anchors in `docs/source-notes.md` are provenance only, not current retry authority.

Evidence classes:

- historical context: upstream notes, old review artifacts, and comparisons that describe design lineage but do not authorize this branch's live retry;
- compatibility evidence: route shape, package mount shape, fixture replay, `finalMatchesLocal`, and similar smoke results that show surface similarity but not live boundary safety; and
- live retry proof: the branch-local live boundary rerun with preserved-remote evidence, stale-authority rejection, a fresh retry scope rebuilt from live hashes, and per-surface old/new/blocked classification.

What the upstream notes prove here:

- Reprint notes prove transport, staged delivery, or resumability vocabulary only; they do not prove live push safety, preserved remote retention, or stale-drift rejection on this branch.
- ZS-Sync notes prove discovery or cursoring vocabulary only; they do not prove source-mutation safety, create-time remap handling, or plugin-owned surface coverage here.
- ForkPress notes prove review or crash-consistency vocabulary only; they do not prove retry authority, preserved-remote auditability, or authority over a later boundary discovered after the note was written.

Production-grade wording must still fail closed unless it names all of these:

- the exact live boundary and the exact stale-drift case;
- the preserved remote that stayed inspectable after rejection;
- the rejection point before the first write;
- the fresh retry scope rebuilt from live hashes on this branch;
- the old/new/blocked classification for every touched surface; and
- the separate preserve / reject / retry cycle for any later-discovered plugin-owned surface or remapped create target.

Production-grade release checklist:

- confirm the exact live boundary and stale-drift case are named in the claim;
- confirm the rejected remote stayed preserved and inspectable for audit, not reused as generic success evidence;
- confirm stale authority was rejected before the first write and the retry scope was rebuilt from live hashes on this branch;
- confirm every touched row, file, relationship-bearing record, and plugin-owned surface is classified old, new, or blocked before retry starts;
- confirm every plugin-owned surface outside the allowlist is enumerated or blocked before write, including hidden tables, cron rows, runtime registries, generated files, caches, serialized blobs, and plugin-owned files;
- confirm any later-discovered plugin-owned surface, remapped create target, or mixed file/DB/plugin side effect is treated as a separate live boundary unless it already had its own preserve / reject / retry cycle before the first write;
- confirm Reprint, ZS-Sync, and ForkPress citations are labeled as provenance only unless this branch reran the same live boundary and the note says what it proves here and what it does not prove here; and
- confirm route-shaped smoke, production-shaped URL, fixture replay, and `finalMatchesLocal` are treated as compatibility evidence only unless they are paired with the preserved remote, rejection point, stale-artifact rejection, and fresh retry scope for the same boundary.

False success to reject:

- "manual resolution later" is not success if the readable artifact is still
  being reused as authority after drift, or if the later boundary never got
  its own preserve/reject/retry cycle on this worktree;
- "manual resolution later" is not success if the route shape merely matches
  production while the executor is copied or fixture-backed behind that same
  URL shape;
- "manual resolution later" is also not success if a remapped create target or
  late-discovered plugin-owned surface was silently folded into the first
  approval instead of getting its own preserve/reject/retry cycle;
- "manual resolution later" is also not success if a plugin-owned data trap was
  only discovered after the first write and then backfilled into the earlier
  approval, because the later surface needs its own preserve/reject/retry
  cycle or an explicit block;
- "same route family" is not success if the later boundary was not rerun here
  with the preserved remote, stale rejection point, and fresh live-hash retry
  scope;
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
- "plugin-safe" is not success if a plugin-owned data trap only became visible
  after the first write and was then treated as covered by the earlier
  approval, because post-write discovery cannot widen the earlier boundary.
- "source-note proof" is not success if the note only matches the same route
  family, package layout, or reviewer wording; shape similarity is not live
  proof of preserved-remote safety, stale-artifact rejection, or retry
  authority on this branch.
- "same upstream note" is not success if the note lacks the exact upstream
  revision or worktree state, the branch-local live rerun, and an explicit
  statement of what it proves here and what it does not prove here.
- "scorecard proof" is not success if the claim points to a high design score
  in `docs/approach-scorecard.md`; that table is a heuristic, not evidence of
  a live boundary rejecting stale authority before mutation.
- "manual resolution" is false reliability unless the same live boundary also
  shows the preserved remote stayed inspectable after rejection, the stale
  approval was rejected before the first write, the retry scope was rebuilt
  from fresh live hashes, and every touched surface was classified old, new,
  or blocked; a readable note by itself is audit evidence only.
- "manual resolution" is also false reliability if it does not name the exact
  live command and exact `REPRINT_PUSH_SOURCE_URL` that produced the evidence;
  without those, the note cannot be audited, rerun, or safely widened to a
  later row, file, relationship-bearing record, remapped create target, or
  plugin-owned surface.
- "manual resolution" is also false reliability if the first write only
  covered a subset of touched surfaces and the remaining file, DB,
  relationship-bearing, or plugin-owned surfaces were discovered later; mixed
  outcomes stay audit evidence only until the whole set is reclassified and
  retried from fresh live hashes.

Checklist before any production-grade wording:

- identify the exact claim being made, then map it to the proof it requires;
- refuse any claim that is only supported by a route shape, mount shape,
  fixture replay, readable review artifact, or `finalMatchesLocal` result;
- require a live boundary rerun on this branch whenever the claim mentions
  stale drift, preserved remote, remapped create targets, or plugin-owned
  surfaces;
- require a separate preserve / reject / retry cycle for any later-discovered
  plugin-owned surface, even if the route family or reviewer wording matches
  an earlier boundary;
- require old/new/blocked classification for every touched surface before
  retry starts, including any mixed file, DB, or plugin side effects;
- require source-note comparisons to state the exact upstream revision or
  worktree state, the branch-local rerun, what the note proves here, and what
  it does not prove here; and
- fail closed on any "manual resolution" description that cannot point to the
  preserved remote, the stale rejection point, and the fresh retry scope
  rebuilt from live hashes on this branch.

Source-note comparisons are historical context unless the exact upstream revision or worktree state is named and this branch reran the same live boundary against the same drift case. A named Reprint, ZS-Sync, or ForkPress note can justify historical transport, discovery, or review vocabulary, but it does not prove the live executor, the preserved remote, retry safety, create-time remap safety, or plugin-owned surface handling on this branch. If the comparison cannot name the exact upstream state, the exact live boundary, what the note proves here, and what it does not prove here, it stays provenance only and cannot support production-grade wording.

That means:

- Reprint notes can justify transport shape, resumability vocabulary, or staged delivery framing, but not live push safety;
- ZS-Sync notes can justify discovery and cursoring shape, but not source-mutation safety; and
- ForkPress notes can justify review vocabulary and durability intent, but not retry authority for this branch.

Even when the upstream state is named precisely, the comparison still does not prove this branch preserved the remote, rejected stale authority before mutation, or rebuilt retry scope from fresh live hashes. At best it proves that the cited note is a valid historical reference point for the same family of ideas.

If any production claim depends only on route shape, package mount shape, fixture replay, readable review output, or `finalMatchesLocal`, the claim must fail closed. Those are compatibility signals, not proof that the live mutation path rejected stale authority before the first write. The branch still lacks a named real-site preflight/release command, so lab or compatibility flows cannot be promoted into production-grade push support.

Concrete failure modes that still block the claim:

- live remote drift after dry-run but before apply;
- create-time identity remapping, aliasing, or renumbering;
- plugin-owned state outside the allowlist, including hidden tables, cron rows, runtime registries, generated files, serialized blobs, caches, and plugin-owned files, especially when the live surface is only discovered after the first write;
- stale manual-review artifacts that remain readable after drift and could be reused against a different boundary, remapped create target, or plugin-owned surface;
- late-discovered plugin-owned surfaces that appear only after the first write and are then folded into the earlier approval without a separate reject/classify/retry cycle; and
- partial file, DB, or plugin side effects that are relabeled as success without old/new/blocked classification for every touched surface, including the case where the first write succeeded but the later retry boundary did not.

Release wording must also avoid implying that a readable review artifact or comparison note is equivalent to a live retry gate. Those artifacts are audit evidence only until the branch shows the preserved remote, rejection point, and fresh retry scope for the same boundary on this worktree. Manual resolution is not success unless the remote is preserved for audit, the stale artifact stays unusable as retry authority, and the fresh retry artifact is recorded separately on this branch.
If a later review rerun produces a fresh-looking manual-resolution note, it still does not inherit the earlier note unless it re-proves the same live boundary here with the preserved remote, the stale rejection point, and a retry scope rebuilt from live hashes.

Production-grade claim blockers that must be named explicitly:

- live remote drift after dry-run but before apply: the branch must show the exact reject point before the first write, the preserved remote that stayed inspectable after rejection, and a fresh retry scope rebuilt from live hashes on this worktree;
- create-time identity remapping, aliasing, or renumbering: the branch must show live identity evidence for the remapped target at apply time, or hard-block the remap before any write; route family, package mount, and fixture shape are not proof;
- plugin-owned data traps outside the allowlist: the branch must enumerate or block hidden tables, cron rows, runtime registries, generated files, caches, serialized blobs, and plugin-owned files before write, including late-discovered surfaces that only appear after the first write; and
- partial file, DB, or plugin side effects: the branch must classify the whole touched set as old, new, or blocked before retry starts, so a mixed outcome cannot be relabeled as success after the committed subset.

Source-note comparisons must stay conservative:

- Reprint notes can justify transport, staged delivery, or resumability vocabulary, but they do not prove live push safety on this branch;
- ZS-Sync notes can justify discovery or cursoring vocabulary, but they do not prove source-mutation safety, retry authority, or partial-side-effect recovery here; and
- ForkPress notes can justify review or durability vocabulary, but they do not prove that a readable artifact can authorize a later row, file, remapped create target, or plugin-owned surface.

Anti-trap wording:

- a lab-shaped route, packaged mount, fixture replay, or `finalMatchesLocal` result can still come from a copied or fixture-backed executor behind the same URL shape, so it is compatibility evidence only and never proof that the live write boundary was production-safe;
- a readable review artifact can prove auditability, but it does not prove the remote was preserved, that stale authority was rejected before mutation, or that retry scope was rebuilt from fresh live hashes on this branch;
- a source-note comparison to Reprint, ZS-Sync, or ForkPress is historical context only unless the exact upstream revision or worktree state is named and the same live boundary was rerun here; and
- any later-discovered plugin-owned surface is a new boundary, not a continuation of the first write, until this branch shows its own preserve / reject / retry cycle with its own preserved remote, rejection point, and fresh retry artifact.

Source-note bottom line:

- Reprint can justify transport vocabulary, but not live push safety;
- ZS-Sync can justify discovery vocabulary, but not source-mutation safety;
- ForkPress can justify review or durability vocabulary, but not retry
  authority; and
- none of the three becomes current proof unless the exact upstream revision
  or worktree state is named and this branch reran the same live boundary with
  preserved-remote evidence and a fresh retry scope.

Production-readiness language checklist:

- name the exact live boundary and the exact stale-drift case;
- show the preserved remote stayed auditable after rejection;
- show the stale approval, review artifact, or comparison note was rejected before mutation and cannot widen to a different row, file, relationship-bearing record, remapped create target, or plugin-owned surface;
- show any later-discovered plugin-owned surface is a new boundary, not an inherited success case, even if it shares the same route family, package mount, or reviewer wording as the first write;
- show the fresh retry artifact was rebuilt from live hashes on this branch, not inherited from earlier approval or copied from a note;
- show the exact live boundary was rerun here, not just a matching route shape or package mount;
- classify every touched surface as old, new, or blocked before retry starts;
- enumerate or block every plugin-owned surface outside the allowlist, including late-discovered tables, files, cron rows, runtime registries, serialized blobs, caches, and generated assets;
- reject any claim that the same route shape, reviewer wording, or fixture replay proves a later boundary; each later-discovered plugin-owned surface still needs its own preserve / reject / retry cycle;
- treat route shape, package mount shape, fixture replay, readable review output, and `finalMatchesLocal` as compatibility evidence only; and
- name the exact upstream revision or worktree state for any Reprint, ZS-Sync, or ForkPress comparison, use the observed anchors from `docs/source-notes.md` (`27c5f25`, `d9334a0`, `55f9879`) when naming the source note, and say what that note proves here and what it does not prove.

Evidence-classification rule:

- if a claim does not explicitly say whether a note, artifact, or smoke is historical context, compatibility evidence, or live retry proof, the wording is ambiguous and must fail closed;
- if a comparison note does not explicitly say what it proves here and what it does not prove here, the wording is ambiguous and must fail closed;
- a Reprint, ZS-Sync, or ForkPress note is historical context unless the exact upstream state and the same live boundary were rerun here;
- a readable manual-review artifact is audit evidence only unless it is paired with the preserved remote, the rejection point, and a fresh retry scope rebuilt from live hashes on this branch; and
- a route-shaped smoke, package-mount match, or `finalMatchesLocal` result is compatibility evidence only and cannot be upgraded into proof for a later row, file, relationship-bearing record, remapped create target, or plugin-owned surface.
