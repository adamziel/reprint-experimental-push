# Critic Audit

## 2026-05-25 Production Push Readiness Re-Audit

Verdict: the design still cannot claim production-grade push support.

The latest lab evidence is real. `b725b2d3` adds an explicit auth/session release boundary, and `b9aebe71` adds another live-boundary delete regression. That improves the safety story, but it does not close the remaining production gap. The project still lacks proof for a real production auth/session lifecycle and durable production journal ownership with lease/fencing/replay wiring. Until those exist, wording about production-ready push is stronger than the evidence.

## What The Source Notes Actually Support

- Reprint contributes staged, resumable transport and protocol versioning.
- ZS-Sync contributes scanner composition and bounded resource enumeration.
- ForkPress contributes the production bar: three-way merge records, reviewed conflict resolution, plugin-specific validators, and crash consistency with old/new/blocked recovery artifacts.

The push design should borrow those pieces, but it still needs its own mutation-grade proof. Transport shape and scanner coverage are not enough.

Latest supervision evidence narrows the remaining gap, but does not close it:
the branch now carries explicit release-boundary wording and a new live delete
regression, yet production auth/session lifecycle and durable journal ownership
with lease/fencing/replay wiring are still not proven on a real WordPress
source site.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Hidden data loss across graph writes | A push edits `wp_postmeta.post_id`, `post_parent`, `_thumbnail_id`, menu links, attachment references, or serialized block payloads while the target identity changed on the remote after pull. | The current proof only blocks a narrow stale-reference case and explicitly says same-plan identity creation and general rewrite remain unsupported. There is no identity map, rewrite proof, or end-to-end referential integrity test for the affected WordPress graph surfaces. | Without automatic rewrite or a hard block for every graph-mutating class, a push can preserve row hashes while breaking relationships or resurrecting the wrong object. |
| Auth/session release boundary is still lab-shaped | A real production request needs cookie, nonce, or Application Password state to survive issuance, scoping, rotation, revocation, replay rejection, and cleanup across retries and crashes. | The recent release-boundary evidence proves only the checked boundary wording and lab behavior. There is still no production auth/session lifecycle with durable retention, replay-safe cleanup, or revocation on the real push path. | Without a real lifecycle, a release gate can accept a request that cannot be audited, replayed safely, or rejected after credential state changes. |
| Durable journal ownership is not yet production-proven | Two workers or a retry race to own the same push journal after a timeout, crash, or network loss, and the old worker resumes late. | The current notes still stop at boundary vocabulary. They do not show durable journal storage with lease/fencing tokens, replay wiring, or a production claim model that survives stale-worker resumption. | A journal without ownership and fencing can let a stale worker publish or replay writes after a newer claim has advanced. |
| Manual resolution can become stale overwrite permission | An operator selects "take local" after reviewing a conflict, then retries after the remote changed again or after a previous attempt left a mixed state. | No reviewed-resolution artifact binds the approval to the exact base/local/remote hashes, reviewer identity, and a fresh live snapshot on retry. The docs say manual resolution is only acceptable if the remote is preserved for audit and retry starts from fresh evidence, but the design does not yet show that artifact or enforcement path. | A stale manual decision is equivalent to granting overwrite permission on new remote data. |
| Plugin data traps remain under-modeled | A plugin stores state in a custom table, generated file, cron row, cache entry, activation hook, or serialized option not covered by the allowlist. | The current plan relies on fixture allowlists and a small set of driver checks. It does not define plugin-owned resource graphs, versioned semantics, rollback expectations, or a conservative fallback for unknown plugin state. | Production push needs to know what each plugin owns, or it must refuse the push. Guessing is unsafe because plugin state often spans tables, files, and runtime side effects. |
| False reliability from lab-backed routes | A route looks production-shaped, returns live hashes, and accepts push-like requests, but the implementation still resolves to Playground internals or fixture-only paths. | The current evidence repeatedly distinguishes lab-backed route shape from production implementation, but the design does not yet provide a production endpoint that is not lab-backed. | A named endpoint is not production support if its success path still depends on copied lab code, fixture scopes, or route-shape smoke tests. |
| Recovery claims stop at classification | After a partial apply, the system can label the remote `old-remote`, `fully-updated-remote`, or `blocked-recovery`, but cannot complete a production repair across every boundary. | The recovery docs intentionally stop at lab evidence. They do not prove durable production journals, kill-at-every-boundary replay, or repair across DB, filesystem, plugin activation, and stale-claim lease boundaries. | Production push must survive real crashes, not just classify them after the fact. |
| Storage boundary proof is still fixture-bounded | A remote changes after dry-run but before a MySQL update, file publish, schema write, activation side effect, or plugin publish. | The guarded write proof is limited to specific Playground fixtures and a narrow set of file/database operations. It does not cover arbitrary production inserts, deletes, schema changes, plugin activation writes, or generic compare-and-swap semantics. | Partial success at a narrow fixture boundary is not proof that arbitrary production writes are safe. |
| Coverage gaps can hide unknown remote state | The remote contains mu-plugin settings, WooCommerce HPOS data, Action Scheduler queues, custom tables, generated assets, or multisite data outside the scanner scope. | The design says unknown coverage should block, but no completed production coverage manifest exists that binds every affected surface into the apply evidence. | If the planner cannot prove it saw the resource, it cannot safely mutate it. |

## Reprint, ZS-Sync, ForkPress

- Reprint is the transport primitive. It does not prove mutation safety by itself.
- ZS-Sync is the change scanner. It does not prove ownership, identity rewrite, or safe apply.
- ForkPress is the reliability bar. It proves the style of evidence this project still needs: reviewed conflicts, plugin drivers, and crash consistency that classifies failures instead of hand-waving them away.

## Changes Required Before A Production Claim

These are the missing proofs that must land before the project can claim production-grade push support:

1. Ship a real production push endpoint whose implementation does not route to
   Playground or lab internals.
2. Separate lab credentials from production push credentials and prove a real
   production auth/session lifecycle: issuance, scoping, rotation, revocation,
   replay rejection, retention, and retry-safe cleanup on the live push path.
3. Build durable production journal ownership with lease/fencing and replay
   wiring, then prove stale-worker resumption cannot write after a newer claim.
4. Introduce a complete production coverage manifest and make unknown plugin,
   custom-table, generated-file, cache, and multisite resources hard blocks.
5. Define plugin-owned resource contracts for tables, files, options, cron,
   cache, and activation hooks, with rollback or block behavior for unknown
   ownership.
6. Add graph identity mapping or broaden the hard block policy so every
   relationship-bearing WordPress row class that can silently rewire identity
   is either rewritten safely or rejected.
7. Add reviewed conflict-resolution artifacts that preserve base/local/remote
   evidence, reviewer identity, chosen action, and fresh revalidation data.
8. Extend storage-boundary checks to production write primitives, including
   inserts, deletes, schema changes, file publish/unlink, plugin activation
   side effects, and any write path that can expose mixed old/new state.
9. Add tombstone and resurrection policy for delete/restore cases so a retry
   cannot silently revive intentionally deleted remote content.
10. Publish production audit/redaction schemas and a release gate that runs the
    full safety-critical suite before the project can use production-grade
    wording.

## Current Bottom Line

The project has credible lab evidence for staged transport, stale-claim handling, and some guarded writes. It still does not prove production auth/session lifecycle or durable journal ownership with lease/fencing/replay. Until those are demonstrated in production-backed code, the honest claim remains: fixture-scoped and lab-backed push evidence, blocked for production.
