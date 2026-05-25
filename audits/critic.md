# Critic Audit

## Current verdict

This design still cannot claim production-grade push support.

The supervised reliable-executor lane now has material retained-source evidence: a `verify:release` lineage, `authSessionType`, minted session shape, `applyCommitted`, `durableJournal.rows: 17`, the `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` verdict at `889bd37a`, the newer `2bdf01a8` proof-contract clarification, and remote head `ee43e194` binding release verification to the supplied source URL. That is concrete progress, but it is still lab evidence. It does not yet prove a live WordPress auth/session lifecycle, preserved-remote retention after rejection, lease/fenced durable journal storage on production-like storage, graph identity, or plugin-driver coverage on a rerunnable mutation boundary. The release gate stays closed until one rerunnable live boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` preserves the rejected remote, revalidates at apply time from fresh live hashes, and proves those production behaviors on the same mutation. Until that exact boundary exists, the best available status is "lab-verified, production-unproven." Reprint, ZS-Sync, and ForkPress only supply source-note lineage here; none of them replace a rerunnable live push boundary on this branch.

The next production proof must be one rerunnable live boundary, not another wording pass: preserve the rejected remote, reject stale authority before the first write, rebuild authority from fresh live hashes at apply time, and keep the same live mutation boundary rerunnable while plugin-owned surfaces are still discoverable.

## What still blocks the claim

1. Production WordPress auth/session lifecycle is not proven on a live mutation boundary.
2. Preserved-remote retention after rejection is not proven, so manual resolution is not auditable retry authority.
3. Apply-time revalidation from fresh live hashes is not proven on the same mutation that produced the rejection, so stale approval can still masquerade as retry authority.
4. Durable journal storage with lease/fencing is only proven in retained-source or lab harness form, not on production-like storage that survives rejection and retry.
5. Graph identity under create-time remap is not proven for relationship-bearing WordPress rows and late-discovered records.
6. Plugin-driver coverage is not proven for plugin-owned surfaces outside the initial allowlist.
7. Partial file, DB, cache, cron, and plugin side effects can still mix without a recovery artifact that says what committed, what was blocked, what stayed preserved, and what must be retried.
8. There is still no single rerunnable live boundary that proves preserved-remote retention, stale-authority rejection before the first write, apply-time revalidation from fresh hashes, and late plugin-owned surface coverage together.
9. The journal has not been proven to survive a real lease/fencing handoff on durable storage while the same boundary remains rerunnable after rejection.
10. The reliable lane’s auth/session evidence stops at retained-source minting and verdicts; it does not yet prove a live WordPress session lifecycle that survives the same rejection/retry boundary as the mutation, including credential expiry, refresh, and operator re-entry on the same rerunnable source URL.
11. No retained-source verdict should be treated as production-grade if it does not survive a rerunnable live mutation on the same source URL with the rejected remote still inspectable.

## Hidden-loss scenarios

- If drift appears after dry-run and before apply, the remote must remain preserved and inspectable. There is no live proof of that rejection path here.
- If create-time remapping rewires identity, the mutation must either preserve graph identity or hard-block. There is no production proof of that behavior.
- If a plugin-owned option, table, cron row, cache entry, generated file, or activation side effect appears late, the push must classify it before any write lands and before any stale approval or cached retry can be reused. There is no coverage proof for that trap on a rerunnable live boundary.
- If a retry reuses stale manual-resolution text, it must not authorize a new mutation. The design does not yet show an auditable artifact that binds the approval to fresh live hashes and the preserved remote, so the retry path can still misrepresent a rejected remote as resolved.
- If a retry boundary can be rerun but does not re-derive authority from the fresh live remote state at apply time, then the boundary is still a lab replay, not production retry authority.
- If the remote is rejected but not preserved, the workflow cannot support safe audit or safe retry, so "manual resolution" remains a label, not proof.
- If a live boundary does not rerun on the same source URL after rejection, then preserved-remote retention, fresh-hash revalidation, and plugin-driver coverage are still disconnected proofs and cannot authorize production wording.
- If the auth/session lifecycle is only demonstrated in retained-source harness output, the design still has no proof that a real WordPress session, nonce, credential refresh, expiry, or operator re-entry survives the same rejection and retry semantics as the push itself.

## Source-note comparison

- Reprint source notes prove staged transport and resumable-delivery vocabulary here, but they do not prove a live mutation boundary, preserved-remote retry authority, or WordPress auth/session lifecycle on this branch.
- ZS-Sync source notes prove discovery and batching vocabulary here, but they do not prove source-mutation safety, create-time remap safety, graph identity, or plugin-owned surface coverage on this branch.
- ForkPress source notes prove audit and crash-consistency vocabulary here, but they do not prove a live WordPress boundary, preserved-remote auditability, durable journal lease/fencing, or plugin-driver coverage on this branch.
- None of them prove live push safety on this branch.
- The missing proof is still one rerunnable live mutation on one exact source URL with preserved-remote retention, apply-time revalidation, auth/session lifecycle, durable journal lease/fencing, graph identity, and plugin-driver coverage all observed together.

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

Manual resolution is not success unless the remote is preserved after rejection, the retry is auditable against fresh live hashes, and the exact boundary can be replayed safely. A reviewer note or retained-source verdict without that preserved remote is not retry authority.

## Must-happen proof

The next acceptable proof is not another wording pass. It is a rerunnable live mutation boundary that produces all of the following on one exact source URL:

- preserved rejected remote, still inspectable after refusal;
- apply-time revalidation from fresh live hashes;
- live WordPress auth/session lifecycle on the same request flow, including expiry and refresh behavior across the rejection/retry boundary;
- durable journal storage with lease/fencing on production-like storage that remains inspectable after rejection;
- graph identity under create-time remap and late-discovered relationship-bearing records; and
- plugin-driver coverage for late plugin-owned surfaces outside the initial allowlist.

Without that single boundary, manual resolution stays a label, not retry authority.

## Release gate checklist

Before any doc or status line says "production-grade" or "release-ready", it must point to a rerunnable live boundary that shows:

- one exact `REPRINT_PUSH_SOURCE_URL` on a real local, Playground, or Docker source;
- the rejected remote preserved and still inspectable after the refusal;
- a dry-run receipt that is not reused as retry authority;
- apply-time revalidation against fresh live hashes from the same boundary;
- WordPress auth/session lifecycle that survives the real boundary, not just a lab-shaped session mint, including expiry and refresh;
- durable journal storage with lease/fencing on production-like storage;
- graph identity for create-time remaps and late-discovered relationship-bearing records; and
- plugin-driver coverage for any plugin-owned surface that appears outside the initial allowlist on the same mutation boundary.

Any claim that skips the live boundary, or replaces it with a retained-source harness or lab fixture, is still not production-grade.
Any claim that relies on manual resolution, cached approval text, or a retained-source verdict without a rerunnable live boundary is false reliability.

If any one of those bullets is missing, the wording must stay in the lab/prototype bucket.

## Strongest blocker

The strongest blocker is still one named, rerunnable live release boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that rejects stale authority before the first write, preserves the rejected remote for audit, revalidates at apply time from fresh live hashes, and proves production WordPress auth/session lifecycle, durable journal storage plus lease/fencing on production-like storage, graph identity, and plugin-driver coverage on the same mutation.

Until that boundary exists, any production-grade push wording is false reliability, even though the supervised lane now has better retained-source evidence and an explicit auth/session lifecycle verdict. The current evidence still stops short of production proof because it does not show a preserved remote surviving rejection, stale authority blocked before the first write, a lease/fenced journal on production-like storage, or a rerunnable apply-time retry that can reject stale manual resolution and late plugin-owned surfaces on the same live source URL.
