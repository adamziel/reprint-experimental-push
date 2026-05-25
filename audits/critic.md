# Critic Audit

## 2026-05-25 Production Push Readiness Re-Audit

Verdict: the design still cannot claim production-grade push support.

The latest lab evidence is real. `b725b2d3` adds an explicit auth/session release boundary, and `b9aebe71` adds another live-boundary delete regression. That improves the safety story, but it does not close the remaining production gap. The project still lacks proof for a real production auth/session lifecycle and durable production journal ownership with lease/fencing/replay wiring. Until those exist, wording about production-ready push is stronger than the evidence.

## What The Source Notes Actually Support

- Reprint contributes staged, resumable transport and protocol versioning.
- ZS-Sync contributes scanner composition and bounded resource enumeration.
- ForkPress contributes the production bar: three-way merge records, reviewed conflict resolution, plugin-specific validators, and crash consistency with old/new/blocked recovery artifacts.

The push design should borrow those pieces, but it still needs its own mutation-grade proof. Transport shape and scanner coverage are not enough.

## Blocking Gaps

| Risk | Scenario | Missing proof | Why this blocks production |
| --- | --- | --- | --- |
| Auth/session lifecycle is still not production-proven | A real WordPress source site issues, refreshes, revokes, or replays push credentials while the operator retries after a failure. | No production auth/session store, no issuance and revocation lifecycle, no replay-retention proof, no scoped push credential policy, and no durable audit trail tied to the live source site. | Without a real lifecycle, authentication can look valid in the lab while stale or replayed credentials remain accepted in production. |
| Journal ownership and fencing remain unproven | One worker claims the apply journal, stalls, another worker advances the lease, and the old worker resumes under load. | No durable production journal ownership model, no lease/fencing token proof, no monotonic claim transfer, and no replay wiring that proves stale workers cannot write. | A journal without fencing can classify failure after the fact but still allow the wrong worker to mutate remote state. |
| Preserve-remote-after-rejection is not fully wired | The operator rejects a conflict, retries later, and the remote changed again in the meantime. | No reviewed-resolution artifact that binds base/local/remote hashes, reviewer identity, chosen action, and a fresh live remote snapshot on retry. | Manual resolution becomes stale overwrite permission unless the remote evidence is preserved and the retry starts from fresh data. |
| Apply-time revalidation is still too narrow | Dry-run passes, but a remote change lands before a later file write, DB write, schema change, or plugin side effect. | No production-backed proof that every mutation rechecks live remote state immediately before the write, across all supported write surfaces. | Dry-run honesty is lost if apply can still commit against stale remote state. |
| Graph identity is not complete enough | A push rewires `postmeta.post_id`, `post_parent`, `_thumbnail_id`, menu links, attachments, terms, or serialized block references after the remote identity changed. | No end-to-end identity map or rewrite proof for all relationship-bearing WordPress surfaces, and no hard block policy that covers every unresolved graph edge. | Row hashes can match while the object graph silently points at the wrong remote identity. |
| Plugin-driver coverage is still too small | A plugin stores state in custom tables, options, cron, cache, generated files, activation hooks, or migrations that the planner does not model. | No complete plugin-owned resource contract, no rollback/block policy for unknown plugin state, and no real plugin driver coverage on one rerunnable boundary. | Plugin state often spans several storage layers; guessing at ownership is a data-loss trap. |
| False reliability claims remain possible | A route looks production-shaped and returns live hashes, but the implementation still resolves to lab internals or fixture-only paths. | No production endpoint that is demonstrably independent from the Playground/lab path. | A production-shaped route is not production support if the success path still depends on lab code. |

## Reprint, ZS-Sync, ForkPress

- Reprint is the transport primitive. It does not prove mutation safety by itself.
- ZS-Sync is the change scanner. It does not prove ownership, identity rewrite, or safe apply.
- ForkPress is the reliability bar. It proves the style of evidence this project still needs: reviewed conflicts, plugin drivers, and crash consistency that classifies failures instead of hand-waving them away.

## Changes Required Before A Production Claim

These are the missing proofs that must land before the project can claim production-grade push support:

1. Ship a real production push endpoint whose implementation does not route through Playground or other lab internals.
2. Prove a real production auth/session lifecycle: issuance, scoping, rotation, revocation, replay rejection, retention, and auditability.
3. Add durable production journal ownership with lease/fencing semantics and replay wiring that prevents stale workers from writing.
4. Preserve remote evidence on rejection and force retry to start from a fresh live snapshot, not from stale approval.
5. Revalidate immediately before each write on every supported storage boundary, not just at dry-run or coarse apply start.
6. Either complete graph identity rewriting or hard-block every unresolved relationship-bearing WordPress edge.
7. Expand plugin-driver coverage to one rerunnable production boundary with explicit ownership, rollback, or block behavior for unknown plugin state.
8. Make the release gate run one rerunnable boundary end to end so auth, journal, revalidation, graph, and plugin safety are proven together.

## Current Bottom Line

The project has credible lab evidence for staged transport, stale-claim handling, and some guarded writes. It still does not prove production auth/session lifecycle or durable journal ownership with lease/fencing/replay. Until those are demonstrated in production-backed code, the honest claim remains: fixture-scoped and lab-backed push evidence, blocked for production.
