# Critic Audit

## 2026-05-25 Production Push Readiness Re-Audit

Verdict: the design still cannot claim production-grade push support.

The protocol is stronger than a generic sync sketch: it has dry-run/apply
separation, live-remote revalidation, idempotency keys, a recovery vocabulary,
and hash-only evidence for several lab slices. That is still not enough to
claim production push on a live WordPress source site. The missing proofs are
not cosmetic. They are the exact points where a partial write, hidden plugin
side effect, stale retry, or graph rewrite can silently lose remote state while
the system reports a plausible success.
In particular, a green lab result never counts as production proof unless the
same live write path was exercised against a drifted remote and the audit shows
the stale approval was rejected before mutation.

Changes that must happen before any production-grade push claim:

- Tie the claim to a real live write-path proof, not route shape,
  packaged-plugin mounting, or `finalMatchesLocal`.
- Prove stale authority fails closed after live drift, while the rejected
  approval remains auditable but unusable for apply.
- Prove create-time identity remapping is either safe and replayable or
  hard-blocked before write.
- Prove plugin-owned state outside the allowlist is either fully enumerated or
  hard-blocked, including ownership revalidation at apply time.
- Prove partial file, DB, or plugin side effects are durably classified and do
  not let a retry widen the old approval.
- Reverify any Reprint, ZS-Sync, or ForkPress comparison against the exact
  upstream commit or worktree state being cited, or label it historical only.

The comparison against Reprint, ZS-Sync, and ForkPress is intentionally
conservative and is grounded in [`docs/source-notes.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/critic/docs/source-notes.md). Those notes contribute transport shape, scanner composition, and reliability vocabulary, but none of them by themselves prove a production source-mutation boundary for this repository. Reprint shows transport stages and resumability, not live mutation safety, production write semantics, or a mutation executor that survives drift. ZS-Sync shows bounded change discovery, not a write policy, create-time identity discipline, or ownership revalidation at apply time. ForkPress shows the reliability bar, but only as a comparison point until this repo proves the same lifecycle with live remote preservation, reviewed-resolution artifacts, and crash classification that survives partial apply. Any claim beyond that would be an inference, not direct evidence from the current upstream repos or from this branch. The observed upstream commit or worktree state in the notes is historical context only; it is not current upstream proof unless this branch re-verifies the same behavior at the mutation boundary today. Route-shape, packaged-plugin, and `finalMatchesLocal` smokes are compatibility evidence only; even when they return live-looking hashes, they should never be read as proof of live source-site safety, remote-preserving retry, manual-review artifact expiry, or production write-path durability. A packaged-plugin mount only proves the route can be loaded in that packaging shape; it does not prove the route is the production executor rather than a lab-backed stand-in, and it does not prove that the exercised route is free of fixture-only storage, lab-only auth, or copied lab internals. If the same ingress returns a plausible hash from a fixture or copied-lab path, the missing proof is still the live mutation boundary, not the HTTP shape. A production claim also cannot rely on “manual resolution will handle it later” unless the remote is preserved, the stale artifact is still auditable but unusable, the retry starts from fresh live evidence, and the old approval cannot be widened to a different row, file, or plugin-owned surface. A stale approval created from a lab-backed route-shape or `finalMatchesLocal` smoke still counts as stale, not current authority. The source notes therefore justify the comparison language, but they do not justify any production-readiness inference about this repo's write path, retry path, or approval lifecycle. Put differently: the notes can justify a design direction, but they do not justify a production claim without repo-specific live write proof. Manual review also cannot be treated as success when the remote changed after review; the proof must show the remote was preserved for audit, the stale artifact failed closed at apply time, and a fresh retry rebuilt scope from current hashes instead of inheriting the old approval. The notes are snapshots of source-note evidence, not standing proof of current upstream behavior, and they cannot be upgraded into current production proof by a route-shape smoke or package mount. A repository note, commit, or README line in Reprint, ZS-Sync, or ForkPress is therefore comparison evidence only; it is not current upstream proof unless this branch independently replays the same live-mutation boundary and shows the same stale-artifact rejection at apply time. Comparison evidence must stay labeled historical unless it is tied to the exact current upstream revision or worktree state and the exact live write boundary under review. If either piece is missing, the comparison is not a proof gap filler; it is just design background. This also means any doc, review comment, or status note that mentions those source notes must name the exact live boundary that was exercised and the exact upstream revision or worktree state that was reverified; otherwise the citation is historical context only and cannot be used to imply production support.
This means a source-note comparison cannot be promoted into live write-path safety unless the claim also names the exact boundary that was exercised and the exact upstream revision or worktree state that was reverified.

Release-claim rule: if a claim does not name the live write boundary, the stale rejection, the preserved remote, the fresh retry scope, and whether the Reprint, ZS-Sync, or ForkPress comparison was reverified at the exact upstream revision/worktree state, it is not production wording. Route-shape smokes, packaged-plugin mounts, fixture replays, and `finalMatchesLocal` remain compatibility evidence only, even when they look current.

Claim rule: if a doc, PR description, review comment, or status note cites Reprint, ZS-Sync, or ForkPress, it must say whether the cited upstream behavior was reverified against the current commit or worktree state. If it was not reverified, the citation stays historical context only. If it cites a route-shape smoke, packaged-plugin mount, or `finalMatchesLocal`, it must also name the live write boundary that was exercised, the remote-drift case that failed closed, and the stale artifact that became audit-only.
If a claim reuses those source notes without naming the exact upstream revision or worktree state that was checked, the claim is overbroad. "Same idea as upstream" is comparison language, not current proof, and it does not satisfy the release gate by itself.
If the branch has not reverified the exact upstream commit or worktree state named in the comparison, the note is historical context only, even when the endpoint path, plugin package, or response hash looks production-shaped.
The source-note comparison has one more hard limit: Reprint's resumable transport proves a staged delivery shape, not a safe source overwrite boundary; ZS-Sync's scanners prove bounded discovery, not a conflict policy for writes; and ForkPress's reviewed merge language proves the right reliability vocabulary, not that this repository has the same live-remote executor or crash-safe mutation boundary. Reprint does not prove live remote drift rejection at the write boundary, ZS-Sync does not prove create-time identity reservation or remote-preserving retry, and ForkPress does not prove that this repo's push path preserves the remote after a partial apply. None of those notes prove that plugin-owned state outside the allowlist is blocked, that a create can reserve stable identity on the live remote, or that a partial file/DB/plugin write leaves an audit trail instead of a false success. The missing proof is always repo-local and executable: a live remote snapshot must disagree, the apply must fail closed before any write, and the audit trail must show the preserved remote plus the rejected scope. A note that is not re-verified against the current upstream commit or worktree state is historical context only; it cannot be upgraded into current proof by matching route shape, package shape, or `finalMatchesLocal`.
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
or a narrowed retry scope.

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
The same warning applies to plugin data traps that are easy to miss in review:
plugin-owned options, custom tables, generated files, activation hooks, cron,
and cache entries can all mutate outside the main post/page row plan. If any
plugin-owned surface can change without a declared contract, a fixture result
or route-shape smoke is not proof that the push preserved remote state.
The source-note comparisons are useful only as context for those failure
classes; they do not prove the current upstream repos still have the cited
behavior, and they do not prove this branch has the same live mutation
boundary today.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Comparison notes can drift from current upstream reality | A doc or status update cites Reprint, ZS-Sync, or ForkPress as if a local note or README snapshot were current upstream proof of behavior today. The claim then inherits upstream semantics without re-verifying the actual commit, branch, or worktree state. | The audit has comparison notes, but no fresh upstream proof attached to the current claim. There is no evidence that the cited upstream behavior still holds today, or that this branch has matched it at the mutation boundary rather than only in a lab-facing description. | If comparison text can be upgraded into current proof by accident, the project can sound production-ready while still lacking repo-specific evidence for the live write path. |
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

## What Reprint, ZS-Sync, And ForkPress Actually Contribute

| Source note | What it proves | What it does not prove | Missing repo proof |
| --- | --- | --- | --- |
| Reprint | Transport stages, resumability, protocol framing, and chunked delivery shape. | Live source overwrite safety, drift rejection at apply time, production auth, or durable write semantics. | A live mutation path that fails closed on stale remote hashes and preserves the remote for audit. |
| ZS-Sync | Bounded discovery, cursor-driven rescans, and changed-resource enumeration. | Write policy, create-time identity reservation, ownership revalidation, or plugin-side effects. | A mutation policy that maps every scanned resource to a safe write rule or a hard block. |
| ForkPress | Reviewed-resolution vocabulary, crash-consistency language, and merge audit framing. | Proof that this repo has the same live-remote executor, stale-artifact expiry, or partial-apply recovery. | A durable reviewed-resolution artifact that expires on drift and forces retry from fresh live evidence. |

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
artifact that expires on remote drift.

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

- live remote drift between dry-run and apply,
- create-time identity remapping,
- plugin-owned state outside the allowlist,
- partial file, DB, or plugin side effects, and
- stale manual-review artifacts that outlive the snapshot they reviewed.

- Name the exact live write path that was exercised, not just the route shape,
  packaged-plugin mount, fixture replay, or `finalMatchesLocal`.
- Name the stale remote-drift case that was rejected before mutation.
- Name the preserved remote snapshot or hash set that made the stale approval
  auditable but unusable for apply.
- Name the retry scope rebuilt from fresh live evidence after drift.
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
  into production proof.
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
- A release-gate proof that a stale review artifact remains readable for
  audit but cannot authorize apply after the remote changes, cannot be
  widened to a different row, file, or plugin-owned surface, and is
  invalidated by the exact live snapshot that broke the match.
- The source-note snapshots themselves are not current upstream proof: a
  locally observed commit, worktree state, or README claim in Reprint, ZS-
  Sync, or ForkPress only anchors the comparison text. It does not prove that
  the upstream repo still has the cited semantics today or that this branch
  has matched them at the mutation boundary.
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
  the stale approval stays readable but unusable, and the retry starts from a
  fresh snapshot and fresh plan after a live revalidation failure, and the
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
| Manual resolution can become stale overwrite permission | An operator manually resolves a conflict, chooses "take local", or fixes a resource in wp-admin, then retries after the live remote changed again or after a partial apply left recovery evidence. | No reviewed-resolution artifact preserves base/local/remote values, remote evidence, reviewer identity, selected action, retry state, live snapshot timestamp, or fresh remote hashes. There is also no proof that a recovered partial apply cannot resurrect the old approval as current authority. Missing proof: the retry is rejected before any write when the remote drifts, the stale artifact remains auditable, and the next retry re-plans from a fresh live snapshot instead of reusing the old decision. | Manual resolution is success only when the remote evidence is preserved, the user can audit and retry safely, and retry creates a new plan from a fresh live remote snapshot. |
| Stale manual-review artifacts can masquerade as current authority | A reviewer approved a conflict yesterday, the source drifted overnight, and a later operator note or retry reuses the old artifact as if it still applied to today’s remote. A second variant is a partial apply that leaves recovery evidence behind and then lets the next retry treat the earlier approval as still current. | There is no proof that stale approval artifacts are rejected before write, preserved with the exact reviewed snapshot, or clearly separated from partial-apply recovery records. Without that, a retry can inherit old permission on new remote data. Missing proof: the stale approval cannot authorize a different row, file, or plugin-owned surface after drift, and a partial recovery cannot resurrect the same approval as if it were fresh. | Reject stale approvals for apply, keep them readable for audit, and force a fresh plan from fresh live evidence before retry. |
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

The ForkPress notes provide the strongest observed comparison point for
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
  approval was rejected before the first write and the remote stayed auditable.
- A create path renumbers, aliases, or remaps identity after pull, but the
  claim treats the old mapping as stable. Missing proof: the remap was either
  proven against a fresh live snapshot or the push failed closed before any
  mutation.
- A plugin owns options, custom tables, generated files, cron rows, cache,
  activation hooks, or other side effects outside the allowlist, but the
  claim treats the planner's coverage as exhaustive. Missing proof: the
  surface was either discovered and validated or hard-blocked before write.
- A push leaves mixed file, DB, or plugin side effects, but the claim reports
  success because one store finished cleanly. Missing proof: the old/new/
  blocked classification is durable and the next retry starts from fresh live
  evidence.
- A manual-review artifact is still readable, but the live hashes changed and
  the retry reused the old approval anyway. Missing proof: the artifact is
  audit-only after drift and cannot widen scope or authorize a new target.
- A comparison to Reprint, ZS-Sync, or ForkPress sounds current because the
  path or package shape matches, but the upstream revision was not reverified.
  Missing proof: the cited upstream state was rechecked at the same live
  mutation boundary and the branch reproduced the rejection behavior there.

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
  or worktree was reverified at the same state.
  Their source-note provenance is limited to `docs/source-notes.md` and does
  not by itself prove any live mutation boundary in this repo.
- A route that only looks production-shaped is not evidence of production
  safety, reliability, or retry correctness.
- A copied lab route that happens to share the production pathname is still
  not production proof unless the same live write boundary was exercised on a
  drifted remote and revalidated immediately before mutation.
- A route-shape smoke, packaged-plugin mount, or `finalMatchesLocal` result
  must never be treated as proof of live remote safety, identity stability,
  plugin-owned side-effect safety, or durable recovery.
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
- A stale manual-review artifact never becomes current authority just because
  the same route or package name is reused; the next retry must reject the old
  approval before write, preserve the remote for audit, and re-plan from a
  fresh live snapshot.
- A stale manual-review artifact must fail closed on the first live-hash
  mismatch even when the same request path still returns the expected route
  shape or a fixture-level `finalMatchesLocal` result.

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
   reusing the stale approval.
5. The claim states whether Reprint, ZS-Sync, or ForkPress source notes were
   reverified against the current upstream commit or worktree state; if not,
   the comparison is context only.
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
11. The claim does not treat Reprint, ZS-Sync, or ForkPress source notes as
    current upstream proof unless the same upstream revision or worktree state
    was reverified and the live write boundary was exercised in this repo.

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

Addendum: each of these conditions must be independently testable in the
release suite. A passing route-shape smoke is not sufficient if any one of the
following still lacks proof:

- live remote drift detected only after a write starts;
- create-time remap or aliasing that changes the target identity;
- plugin-owned state outside the allowlist that remains writable;
- partial file, DB, or plugin side effects that cannot be fenced or audited;
- stale manual-review artifacts that can be replayed as current authority.

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
  can still be audited and retried safely.
- A mounted route that returns live-looking hashes still has to prove how
  partial file, DB, or plugin side effects are classified and retried; the
  hash alone never proves the write executor, the plugin-owned boundary, or
  that the route is anything more than a fixture-backed stand-in.
- Manual resolution is not a success state unless the remote is preserved for
  audit, the stale artifact is rejected before write, and the retry starts
  from fresh live evidence with no scope widening.
- A stale manual-review artifact remains readable for audit but must become
  unusable as authority as soon as the live hashes change; readability alone
  is not a success condition, and the retry must rebuild scope from fresh
  live evidence rather than inheriting the old approval.
- Reprint, ZS-Sync, and ForkPress notes are comparison evidence only; they do
  not prove current upstream behavior today, and they do not prove this repo's
  live mutation boundary unless the same upstream revision or worktree was
  independently reverified.
- A claim that cites those notes must say whether the upstream revision or
  worktree was reverified. If it was not, the note is historical context only
  and cannot support production wording.
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

Until then, the project is a strong lab for the right invariants, not
production-grade source-site push support.
