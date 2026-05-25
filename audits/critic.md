# Critic Audit

## 2026-05-26 24-Hour Readiness Critique

Verdict: the design still cannot claim production-grade push support.

The current evidence is still narrow and lab-shaped. The recent reliable-lane work improves the boundary checks, but it only proves replay idempotency and failure handling inside the release verifier. It does not yet prove a live production auth/session lifecycle, durable journal ownership with lease/fencing, preserved-remote retry, or exact replay equivalence on the real push path. For the next 24 hours, the claim must stay cut to a constrained release-candidate slice, not broad production support.

## What The Source Notes Actually Support

- Reprint contributes staged, resumable transport and protocol versioning.
- ZS-Sync contributes scanner composition and bounded resource enumeration.
- ForkPress contributes the production bar: three-way merge records, reviewed conflict resolution, plugin-specific validators, and crash consistency with old/new/blocked recovery artifacts.

The lane snapshots have moved, and two blocker classes are now narrower: `no-data-loss-invariants` has an executable proof that comments/users, serialized block references, plugin-owned custom-table mismatches, and the `_thumbnail_id` attachment edge stay hard-blocked, and `no-data-loss-recovery` now fails closed on unsupported durable-journal claims unless the writer exposes restart-oriented capabilities. That is useful, but it still does not close the broader production claim. The only safe critic update is a tighter verdict, not another head list.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Hidden data loss across graph writes | A push edits `wp_postmeta.post_id`, `post_parent`, `_thumbnail_id`, menu links, attachment references, or serialized block payloads while the target identity changed on the remote after pull. | The current proof only blocks a narrow stale-reference case and explicitly says same-plan identity creation and general rewrite remain unsupported. There is no identity map, rewrite proof, or end-to-end referential integrity test for the affected WordPress graph surfaces. | Without automatic rewrite or a hard block for every graph-mutating class, a push can preserve row hashes while breaking relationships or resurrecting the wrong object. |
| Auth/session release boundary is still lab-shaped | A real production request needs cookie, nonce, or Application Password state to survive issuance, scoping, rotation, revocation, replay rejection, and cleanup across retries and crashes. | The release verifier proves only the checked boundary wording and lab behavior. There is still no production auth/session lifecycle with durable retention, replay-safe cleanup, or revocation on the real push path. | Without a real lifecycle, a release gate can accept a request that cannot be audited, replayed safely, or rejected after credential state changes. |
| Replay output is not proven exact | A replayed release response returns `200` and `replayed=true` but differs from the original completed apply in body fields that callers or auditors depend on. | The release verifier now proves replay idempotency at the mutation boundary, but it still does not prove exact replay equivalence, canonical response stability, or field-level identity with the original apply response. | A release gate that only checks broad success can bless a replay that is semantically different from the original apply. |
| Durable journal ownership is not yet production-proven | Two workers or a retry race to own the same push journal after a timeout, crash, or network loss, and the old worker resumes late. | The notes still stop at boundary vocabulary. They do not show durable journal storage with lease/fencing tokens, replay wiring, or a production claim model that survives stale-worker resumption. | A journal without ownership and fencing can let a stale worker publish or replay writes after a newer claim has advanced. |
| Recovery durability is fail-closed but not yet proven live | The system rejects unsupported durable-journal claims unless the writer exposes restart-oriented capabilities, but the live storage backend and restart-readable artifacts are still absent. | The new guard is a boundary check, not a production backend. There is still no live durable journal writer, no restart-readable artifact inspection, and no proof that a real failure path can recover without manual intervention. | A fail-closed guard prevents false claims, but it does not yet prove a real recovery path. |
| Preserved-remote retry is not proven | A retry after partial apply reuses stale local evidence and overwrites the remote instead of resuming from an auditable preserved remote snapshot. | There is no end-to-end proof that the remote state is retained, reloaded, and compared before retry, or that replay is fenced so a retry cannot silently choose a newer or older remote than the one first observed. | Retry safety is part of production durability; without preserved remote evidence, a second attempt can become a blind overwrite. |
| Manual resolution can become stale overwrite permission | An operator selects "take local" after reviewing a conflict, then retries after the remote changed again or after a previous attempt left a mixed state. | No reviewed-resolution artifact binds the approval to the exact base/local/remote hashes, reviewer identity, and a fresh live snapshot on retry. The docs say manual resolution is only acceptable if the remote is preserved for audit and retry starts from fresh evidence, but the design does not yet show that artifact or enforcement path. | A stale manual decision is equivalent to granting overwrite permission on new remote data. |
| Plugin data traps remain under-modeled | A plugin stores state in a custom table, generated file, cron row, cache entry, activation hook, or serialized option not covered by the allowlist. | The current plan now hard-blocks some plugin-owned custom-table mismatches, but it still does not define plugin-owned resource graphs, versioned semantics, rollback expectations, or a conservative fallback for unknown plugin state. | Production push needs to know what each plugin owns, or it must refuse the push. Guessing is unsafe because plugin state often spans tables, files, and runtime side effects. |
| Graph identity can still rewire silently | Two posts, taxonomy objects, menu items, serialized block references, comments/users, or plugin-owned custom-table records share enough shape that a rerun or partial retry binds relationships to the wrong remote object. The attachment `_thumbnail_id` edge is now specifically covered, but the broader graph is not. | The current notes now hard-block some identity-bearing surfaces, but there is still no complete identity map and no proof that every relationship-bearing row class is either rewritten safely or rejected. There is no demonstrated coverage for the full identity-bearing graph, only narrow stale-reference checks and the newly blocked unsupported boundary classes. | A push can succeed syntactically while connecting the wrong content graph, which is a quiet integrity failure rather than an obvious crash. |
| Plugin driver coverage is still partial | A plugin writes through custom tables, generated files, caches, cron, or activation side effects that the driver suite never enumerates. | The design still lacks a production-grade driver contract for unknown plugin ownership. There is no proof that the driver layer blocks unsupported plugins instead of drifting into best-effort mutation. | Missing plugin drivers turn the allowlist into an optimistic guess, and guesses are not safe for production mutation. |
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

1. Ship a real production push endpoint whose implementation does not route to Playground or lab internals.
2. Separate lab credentials from production push credentials and prove a real production auth/session lifecycle: issuance, scoping, rotation, revocation, replay rejection, retention, and retry-safe cleanup on the live push path.
3. Build durable production journal ownership with lease/fencing and replay wiring, then prove stale-worker resumption cannot write after a newer claim.
4. Prove preserved-remote retry from a real remote snapshot so a retry cannot silently become a stale overwrite or resume from the wrong remote state.
5. Introduce a complete production coverage manifest and make unknown plugin, custom-table, generated-file, cache, and multisite resources hard blocks.
6. Define plugin-owned resource contracts for tables, files, options, cron, cache, and activation hooks, with rollback or block behavior for unknown ownership.
7. Add graph identity mapping or broaden the hard block policy so every relationship-bearing WordPress row class that can silently rewire identity is either rewritten safely or rejected, starting with menu/navigation, serialized block references, comments/users, and plugin-owned custom tables.
8. Add reviewed conflict-resolution artifacts that preserve base/local/remote evidence, reviewer identity, chosen action, and fresh revalidation data.
9. Extend storage-boundary checks to production write primitives, including inserts, deletes, schema changes, file publish/unlink, plugin activation side effects, and any write path that can expose mixed old/new state.
10. Add tombstone and resurrection policy for delete/restore cases so a retry cannot silently revive intentionally deleted remote content.
11. Publish production audit/redaction schemas and a release gate that runs the full safety-critical suite before the project can use production-grade wording.

## 24-Hour Readiness

Three blockers can still move in this window:

1. Reliable executor: finish the live release proof or prove the packaged route is still lab-backed.
2. No-data-loss recovery: convert the fail-closed durable-journal boundary into a real preserved-remote retry with lease/fencing and restart-readable artifacts, or keep the production claim blocked.
3. No-data-loss invariants: extend the hard-block coverage to the next unsupported boundary such as menu/navigation or revision posts, and keep the fail path executable in a test or planner hook.

One claim must be cut:

- Do not call the push path production-grade until exact replay equivalence and durable journal ownership are proven on the real push path.

The next exact failure target should be:

- [`scripts/playground/production-shaped-release-verify.mjs`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic/scripts/playground/production-shaped-release-verify.mjs) and [`test/production-shaped-proof.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-mainwindows-2349/critic/test/production-shaped-proof.test.js): keep or add a failing assertion that the release command is rejected unless the packaged route is not lab-backed, the replay response is canonical, and unsupported graph/plugin/storage surfaces are blocked.

## Current Bottom Line

The project has credible lab evidence for staged transport, stale-claim handling, replay idempotency, some guarded writes, and a fail-closed durable-journal boundary. It still does not prove production auth/session lifecycle, durable journal ownership with lease/fencing/replay, preserved-remote retry, exact replay equivalence, or full graph identity safety. The honest claim remains unchanged: fixture-scoped and lab-backed push evidence, blocked for production.
