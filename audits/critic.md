# Critic Audit

## Current verdict

This design still cannot claim production-grade push support.

The supervised reliable-executor lane now has material retained-source evidence: a `verify:release` lineage, `authSessionType`, minted session shape, `applyCommitted`, `durableJournal.rows: 17`, and the newer `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` verdict at `889bd37a`, with remote head `d6285b18` tightening the release-proof boundary instead of pretending the command surface is absent. That is real progress, but it is still lab evidence. The project still lacks one rerunnable live boundary on one real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote after refusal, revalidates at apply time from fresh live hashes, and proves production auth/session lifecycle, durable journal storage plus lease/fencing on production-like storage, graph identity, and plugin-driver coverage on the same mutation. Wording alone does not close that gap, and manual resolution is not success unless the rejected remote stays inspectable and retryable.

## What still blocks the claim

1. Production WordPress auth/session lifecycle is not proven on a live mutation boundary.
2. Preserved-remote retention after rejection is not proven, so manual resolution is not auditable retry authority.
3. Apply-time revalidation from fresh live hashes is not proven on the same mutation that produced the rejection, so stale approval can still masquerade as retry authority.
4. Durable journal storage with lease/fencing is only proven in retained-source or lab harness form, not on production storage.
5. Graph identity under create-time remap is not proven for relationship-bearing WordPress rows and late-discovered records.
6. Plugin-driver coverage is not proven for plugin-owned surfaces outside the initial allowlist.
7. The design still leaves hidden-loss modes where partial file, DB, cache, cron, and plugin side effects can mix without a production recovery artifact that cleanly classifies what committed, what was blocked, what must remain preserved for audit, and what must be retried.
8. There is still no proof of a single rerunnable boundary that can preserve the rejected remote, reject stale authority before the first write, rerun apply-time revalidation after fresh hashes are rebuilt, and cover plugin-owned surfaces that appear late on the same mutation.
9. There is still no production proof that the journal can survive a real lease/fencing handoff on durable storage while the same boundary remains rerunnable after rejection.
10. The reliable lane’s auth/session evidence stops at retained-source minting and verdicts; it does not yet prove a live WordPress session lifecycle that survives the same rejection/retry boundary as the mutation.
11. There is still no single rerunnable live release boundary that ties preserved-remote retention, apply-time revalidation, WordPress auth/session lifecycle, durable journal lease/fencing, graph identity, and plugin-driver coverage to the same source URL, so retry authority remains unproven outside the lab harness.
12. No retained-source verdict should be treated as production-grade if it does not survive a rerunnable live mutation on the same source URL with the rejected remote still inspectable.

## Hidden-loss scenarios

- If drift appears after dry-run and before apply, the remote must remain preserved and inspectable. There is no live proof of that rejection path here.
- If create-time remapping rewires identity, the mutation must either preserve graph identity or hard-block. There is no production proof of that behavior.
- If a plugin-owned option, table, cron row, cache entry, generated file, or activation side effect appears late, the push must classify it before any write lands and before any stale approval or cached retry can be reused. There is no coverage proof for that trap on a rerunnable live boundary.
- If a retry reuses stale manual-resolution text, it must not authorize a new mutation. The design does not yet show an auditable artifact that binds the approval to fresh live hashes and the preserved remote, so the retry path can still misrepresent a rejected remote as resolved.
- If a retry boundary can be rerun but does not re-derive authority from the fresh live remote state at apply time, then the boundary is still a lab replay, not production retry authority.
- If the remote is rejected but not preserved, the workflow cannot support safe audit or safe retry, so "manual resolution" remains a label, not proof.
- If a live boundary does not rerun on the same source URL after rejection, then preserved-remote retention, fresh-hash revalidation, and plugin-driver coverage are still disconnected proofs and cannot authorize production wording.
- If the auth/session lifecycle is only demonstrated in retained-source harness output, the design still has no proof that a real WordPress session, nonce, or operator credential survives the same rejection and retry semantics as the push itself.

## Source-note comparison

- Reprint source notes contribute staged transport and resumable-delivery lineage, but not live mutation safety, preserved-remote retry, or WordPress auth/session lifecycle proof on this branch.
- ZS-Sync source notes contribute discovery and batching lineage, but not source-mutation safety, create-time remap safety, or plugin-owned surface coverage on this branch.
- ForkPress source notes contribute audit and crash-consistency vocabulary, but not a live WordPress boundary with preserved-remote auditability, durable journal lease/fencing, or plugin-driver coverage on this branch.
- The three families are useful as lineage context only: Reprint helps with staged delivery vocabulary, ZS-Sync with scanning/batching vocabulary, and ForkPress with recovery/audit vocabulary; none of them prove the branch preserved the rejected remote, rebuilt retry scope from live hashes, or covered plugin-owned surfaces on a rerunnable live boundary.
- In other words: Reprint is delivery lineage, ZS-Sync is discovery lineage, ForkPress is recovery lineage, and this branch still needs a live push boundary to prove authority, fencing, retry safety, and graph identity.
- The comparison also does not prove live auth/session lifecycle; that remains missing from the production claim even if the lineage vocabulary is correct.
- Any comparison to those notes must name the exact upstream revision or worktree state, say what the note proves here, and say what it does not prove here. If it only supports historical vocabulary, it stays provenance only and cannot be used as production proof by analogy.

## Changes required before production wording is defensible

Before the project can claim production-grade push support, one rerunnable live boundary must show all of the following on the same mutation:

- exact stale-drift rejection before the first write;
- preserved remote still inspectable after rejection and usable for audit;
- dry-run receipt plus apply-time revalidation on fresh live hashes;
- production WordPress auth/session lifecycle;
- durable journal storage with lease/fencing semantics on production-like storage;
- graph identity across create-time remaps and late-discovered relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces outside the initial allowlist; and
- retry scope rebuilt from fresh live evidence, not manual-resolution text, cached approvals, or previously rejected hashes.

If any one of those proofs is only available through retained-source lab output, the release claim remains false.

The production claim also fails closed if any of these are only shown on a lab fixture, retained-source harness, or review artifact:

- auth/session lifecycle shape without a live remote boundary;
- journal rows without storage and lease/fencing behavior on production-like storage;
- graph identity without create-time remap and late-discovered relationship-bearing record coverage;
- plugin-driver behavior without a rerunnable boundary on a real source URL that can reclassify late plugin-owned writes; or
- preserved-remote wording without the rejected remote still being inspectable after rejection.

Manual resolution is not success unless the remote is preserved after rejection, the retry is auditable against fresh live hashes, and the exact boundary can be replayed safely.

## Release gate checklist

Before any doc or status line says "production-grade" or "release-ready", it must point to a rerunnable live boundary that shows:

- one exact `REPRINT_PUSH_SOURCE_URL` on a real local, Playground, or Docker source;
- the rejected remote preserved and still inspectable after the refusal;
- a dry-run receipt that is not reused as retry authority;
- apply-time revalidation against fresh live hashes from the same boundary;
- WordPress auth/session lifecycle that survives the real boundary, not just a lab-shaped session mint;
- durable journal storage with lease/fencing on production-like storage;
- graph identity for create-time remaps and late-discovered relationship-bearing records; and
- plugin-driver coverage for any plugin-owned surface that appears outside the initial allowlist.

Any claim that skips the live boundary, or replaces it with a retained-source harness or lab fixture, is still not production-grade.
Any claim that relies on manual resolution, cached approval text, or a retained-source verdict without a rerunnable live boundary is false reliability.

If any one of those bullets is missing, the wording must stay in the lab/prototype bucket.

## Strongest blocker

This worktree still lacks one named, rerunnable live release command on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote, revalidates at apply time, and proves production WordPress auth/session lifecycle, durable journal storage plus lease/fencing, graph identity, and plugin-driver coverage on the same mutation.

Until that boundary exists, any production-grade push wording is false reliability, even though the supervised lane now has better retained-source evidence and an explicit auth/session lifecycle verdict. The current evidence still stops short of production proof because it does not show a preserved remote surviving rejection, a lease/fenced journal on production-like storage, or a rerunnable apply-time retry that can reject stale manual resolution and late plugin-owned surfaces on the same live source URL.
