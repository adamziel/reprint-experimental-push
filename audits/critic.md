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

The comparison against Reprint, ZS-Sync, and ForkPress is intentionally
conservative and is grounded in [`docs/source-notes.md`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/critic/docs/source-notes.md). Those notes contribute transport shape, scanner composition, and reliability vocabulary, but none of them by themselves prove a production source-mutation boundary for this repository. Reprint shows transport stages and resumability, not live mutation safety, production write semantics, or a mutation executor that survives drift. ZS-Sync shows bounded change discovery, not a write policy, create-time identity discipline, or ownership revalidation at apply time. ForkPress shows the reliability bar, but only as a comparison point until this repo proves the same lifecycle with live remote preservation, reviewed-resolution artifacts, and crash classification that survives partial apply. Any claim beyond that would be an inference, not direct evidence. Route-shape, packaged-plugin, and `finalMatchesLocal` smokes are compatibility evidence only; even when they return live-looking hashes, they should not be read as proof of live source-site safety, remote-preserving retry, manual-review artifact expiry, or production write-path durability. A packaged-plugin mount only proves the route can be loaded in that packaging shape; it does not prove the write path is the production executor rather than a lab-backed stand-in, and it does not prove that the exercised route is free of fixture-only storage, lab-only auth, or copied lab internals. If the same ingress returns a plausible hash from a fixture or copied-lab path, the missing proof is still the live mutation boundary, not the HTTP shape. A production claim also cannot rely on “manual resolution will handle it later” unless the remote is preserved, the stale artifact is still auditable but unusable, the retry starts from fresh live evidence, and the old approval cannot be widened to a different row, file, or plugin-owned surface. A stale approval created from a lab-backed route-shape or `finalMatchesLocal` smoke still counts as stale, not current authority. The source notes therefore justify the comparison language, but they do not justify any production-readiness inference about this repo's write path, retry path, or approval lifecycle. Put differently: the notes can justify a design direction, but they do not justify a production claim without repo-specific live write proof. Manual review also cannot be treated as success when the remote changed after review; the proof must show the remote was preserved for audit, the stale artifact failed closed at apply time, and a fresh retry rebuilt scope from current hashes instead of inheriting the old approval.
The source-note comparison has one more hard limit: Reprint's resumable transport proves a staged delivery shape, not a safe source overwrite boundary; ZS-Sync's scanners prove bounded discovery, not a conflict policy for writes; and ForkPress's reviewed merge language proves the right reliability vocabulary, not that this repository has the same live-remote executor or crash-safe mutation boundary. None of those notes prove that plugin-owned state outside the allowlist is blocked, that a create can reserve stable identity on the live remote, or that a partial file/DB/plugin write leaves an audit trail instead of a false success.
No source note proves that a stale manual-review artifact can survive a live
drift and still authorize apply, so any retry claim has to be backed by a
fresh snapshot, a fresh plan, and a rejected old artifact that remains
auditable rather than reusable.
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
The same warning applies to plugin data traps that are easy to miss in review:
plugin-owned options, custom tables, generated files, activation hooks, cron,
and cache entries can all mutate outside the main post/page row plan. If any
plugin-owned surface can change without a declared contract, a fixture result
or route-shape smoke is not proof that the push preserved remote state.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Hidden data loss across graph writes | A push edits `wp_postmeta.post_id`, `post_parent`, `_thumbnail_id`, menu links, attachment references, or serialized block payloads while the target identity changed on the remote after pull. A second variant is a same-plan create that invents a new target identity and rewrites relationship rows to point at it. | The current proof only blocks a narrow stale-reference case and explicitly says same-plan identity creation and general rewrite remain unsupported. There is no identity map, rewrite proof, or end-to-end referential integrity test for the affected WordPress graph surfaces, so the push can neither prove safe remapping nor prove it refused the remap. | Without automatic rewrite or a hard block for every graph-mutating class, a push can preserve row hashes while breaking relationships, hiding descendants, or resurrecting the wrong object. |
| New-object identity collisions | Local and remote both create new posts, attachments, terms, or plugin-owned records after the pull base, and the planner later sees matching slugs, import IDs, filenames, or other human-friendly keys. A same-plan create may also be renumbered, aliased, or reassigned during retry. | There is no stable allocation proof that separates "same label" from "same identity" for newly created objects. The docs talk about pull-base binding and graph rewrites, but they do not show a remote-safe identity map, reservation scheme, or replay-safe create mapping for objects that did not exist at base time. | A production push can silently merge or overwrite distinct objects if new identities are inferred from mutable labels instead of a durable identity map. |
| Manual resolution can become stale overwrite permission | An operator selects "take local" after reviewing a conflict, then retries after the remote changed again or after a previous attempt left a mixed state. A second case is an approval recorded for one plan hash and then reused after a different live remote snapshot or a partial recovery replay. A third case is a mixed-scope retry where only part of the plan was approved locally, but the next apply silently reuses that approval for unrelated rows or files. | No reviewed-resolution artifact binds the approval to the exact base/local/remote hashes, reviewer identity, live snapshot timestamp, and retry scope. The docs say manual resolution is only acceptable if the remote is preserved for audit and retry starts from fresh evidence, but the design does not yet show the artifact, server-side enforcement, or retry rejection path when the approved snapshot is stale. Missing proof: a retry after remote drift is rejected before any write, the stale approval remains readable for audit, the rejected artifact cannot be widened into a different row/file/plugin surface, the remote-preserving retry starts from a new snapshot rather than reusing the old decision, a partial approval cannot be broadened to unrelated targets, and a recovered partial apply cannot resurrect the old approval as if it were still current. | A stale manual decision is equivalent to granting overwrite permission on new remote data. |
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

### Reprint

Reprint gives the transport skeleton: preflight, chunking, resumability, and
protocol versioning. The source notes prove pull/export mechanics and a
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
The source notes show a bounded changed-resource list and continuous rescans,
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
evidence for all of these, not just a plausible design:

- The source notes for Reprint, ZS-Sync, and ForkPress are treated as
  conservative design input only. They do not prove live remote drift
  rejection, stable identity reservation for creates, plugin-owned state
  revalidation, durable recovery, remote-preserving retry after drift, stale
  manual-review artifact rejection, or a production write boundary in this
  repo.
- Those notes also do not justify production wording by association. A future
  doc or status comment must still show live write-path proof in this repo; a
  strong transport shape, scanner model, or crash vocabulary is not enough.
- Those notes also do not prove that a stale approval stays auditable while a
  retry preserves the remote, re-plans from fresh evidence, and rejects any
  widened scope before write.
- A real production Reprint push endpoint that does not resolve to Playground
  or copied lab internals, plus a repo-specific proof that package mounting
  only exposes the endpoint shape rather than the write-path semantics.
- The source-note snapshots themselves are not current upstream proof: a
  locally observed commit, worktree state, or README claim in Reprint, ZS-
  Sync, or ForkPress only anchors the comparison text. It does not prove that
  the upstream repo still has the cited semantics today or that this branch
  has matched them at the mutation boundary.
- A route that looks production-shaped, returns live hashes, or passes a
  packaged-plugin smoke must still be proven against a live remote with drift;
  those results are compatibility evidence only and do not prove production
  write safety, credential isolation, or durable retry behavior.
- The same warning applies to `finalMatchesLocal`: a fixture-level match only
  proves the lab surface converged, not that the live remote was preserved or
  that a stale approval was rejected before write.
- Manual resolution is only acceptable if the remote is preserved for audit,
  the stale approval stays readable but unusable, and the retry starts from a
  fresh snapshot and fresh plan after a live revalidation failure.
- Route shape, packaged-plugin smoke results, and fixture `finalMatchesLocal`
  outputs are compatibility evidence only; they are never sufficient by
  themselves to claim production mutation safety, credential isolation, or
  remote-preserving retry semantics.
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
- Durable journals and kill-at-every-boundary recovery proofs across DB,
  filesystem, and plugin boundaries.
- A release gate that runs the full safety-critical suite before any
  production claim ships, and that gate must fail closed on stale manual
  review artifacts, unknown plugin ownership, route-shape-only evidence, or
  fixture-only replay evidence.
- False reliability claims are not allowed: a route-shape smoke, packaged
  plugin mount, or `finalMatchesLocal` result cannot be summarized as
  production-safe, retry-safe, or durable unless the live write path, fresh
  snapshot, and stale-artifact rejection have all been proven.

## Release Gate Checklist

Use this checklist before any doc, PR, or status comment says the project has
production-grade push support:

- Route shape, packaged-plugin mounting, and `finalMatchesLocal` are
  compatibility checks only. They do not prove production safety, because they
  can succeed while the live remote has drifted, the write path is still
  lab-backed, or stale manual-review artifacts are being reused.
- A production claim must show the live remote was revalidated at the actual
  apply boundary, not just during dry-run or fixture planning.
- A production claim must fail closed on create-time identity remapping unless
  the repo proves durable identity reservation and reference rewriting for that
  exact live object class.
- A production claim must fail closed on plugin-owned state outside the
  declared allowlist, including plugin tables, options, generated files,
  activation side effects, cron, and cache state, unless a semantic driver
  proves the mutation surface exactly.
- A production claim must fail closed on partial file/DB/plugin side effects;
  a split remote state is not success unless the remote is preserved for audit
  and the retry path can prove safe recovery from fresh evidence.
- A stale manual-review artifact may stay readable for audit, but it must not
  be treated as current authority after remote drift or partial apply.
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
  block, not a candidate for manual resolution.
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
- A lab route that looks production-shaped is not production proof, even if it
  returns live hashes, mounts as a plugin, or replays successfully on a
  fixture. Those results only show compatibility with the lab path that was
  exercised; they do not prove the live source mutation path is safe against
  remote drift, identity remapping, or plugin-owned side effects.
- Reprint, ZS-Sync, and ForkPress source notes are comparison evidence only;
  they do not transfer safety proof to this repository by resemblance alone.
  Their notes can justify transport shape, scanner shape, or reliability
  vocabulary, but they do not prove this repo's live write path, identity
  reservation, plugin ownership enforcement, or stale-artifact rejection.
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
- A stale manual-review artifact may stay readable for audit, but once the
  live remote hash or snapshot timestamp changes it is no longer current
  authority and cannot be widened to a different row, file, or plugin-owned
  surface.
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
- Rejected manual-review artifacts must remain readable for audit, but they
  cannot be widened, repurposed, or treated as current authority for a
  different retry scope.
- A stale manual-review artifact that once matched the plan hash must still be
  rejected if the live remote snapshot, coverage hash, or retry scope has
  changed.
- The release gate fails closed on live remote drift, identity remapping on
  create, plugin-owned data outside allowlists, partial file/DB/plugin side
  effects, and stale manual-review artifacts even when a lab smoke passes.
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
| Stale manual-review artifacts can masquerade as current authority | A reviewer approved a conflict yesterday, the source drifted overnight, and a later operator note or retry reuses the old artifact as if it still applied to today’s remote. | There is no proof that stale approval artifacts are rejected before write, preserved with the exact reviewed snapshot, or clearly separated from partial-apply recovery records. Without that, a retry can inherit old permission on new remote data. Missing proof: the stale approval cannot authorize a different row, file, or plugin-owned surface after drift. | Reject stale approvals for apply, keep them readable for audit, and force a fresh plan from fresh live evidence before retry. |
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

Required change: use ZS-Sync-style scanning as planning input only. A ready
push must block on unknown or incomplete coverage.

### ForkPress

The ForkPress notes provide the closest production reliability bar:
three-way merge records, reviewed conflict resolution, plugin validators,
revalidation, and crash consistency where failure is old, new, or blocked with
artifacts. They cover branch merge auditability and crash consistency across
WordPress files and SQLite data, not live push of a remote source site. ForkPress
is the strongest comparison point because it treats manual conflict handling as
a first-class audited state, but it still does not prove this repository's live
remote path, graph identity remapping, or plugin-owned state handling.

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
`finalMatchesLocal` does not change that rule; it is still only a fixture
compatibility signal, not proof of a safe retry after drift.

Required change: adopt the ForkPress-grade lifecycle before making
ForkPress-grade claims. Manual resolution is acceptable only when the remote
is preserved for audit, retries start from fresh evidence, and partial side
effects are classified without reusing stale manual permission or stale
approval artifacts.

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
  route name, package name, or lab smoke output still looks correct.
- Stale approvals remain audit artifacts only; they cannot authorize a new
  row, file, option, or plugin-owned surface after drift.
- Manual resolution is not a success condition unless the remote remains
  preserved for audit and the retry can be replayed safely from fresh live
  evidence.
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
- A route that only looks production-shaped is not evidence of production
  safety, reliability, or retry correctness.
- A route-shape smoke, packaged-plugin mount, or `finalMatchesLocal` result
  must never be treated as proof of live remote safety, identity stability,
  plugin-owned side-effect safety, or durable recovery.
- Comparisons to Reprint, ZS-Sync, and ForkPress remain source-note evidence
  only; they cannot be upgraded into proof of production push support without a
  repo-specific live mutation path.
- A manual review artifact is only acceptable when the remote snapshot,
  reviewed scope, and hashes still match at apply time; otherwise the artifact
  must stay audit-only and be rejected before any write.
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
    reassign target identity without a live remap proof.

The release gate is not satisfied by "looks production-shaped" evidence. A
route that mounts in the right package, returns live-looking hashes, or passes
fixture replay still needs a live remote revalidation proof at the actual write
boundary, plus stale-approval rejection and auditable retry behavior under drift.

Until then, the project is a strong lab for the right invariants, not
production-grade source-site push support.
