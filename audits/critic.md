# Critic Audit

## Current verdict

This design still cannot claim production-grade push support.

The supervised reliable-executor lane now has material retained-source evidence: a `verify:release` lineage, `authSessionType`, minted session shape, `applyCommitted`, `durableJournal.rows: 17`, and an explicit `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` verdict. That is real progress, but it is still lab evidence. The next missing proof is one rerunnable live boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote, revalidates at apply time, and proves production auth/session lifecycle, durable journal storage plus lease/fencing, graph identity, and plugin-driver coverage on the same mutation.

## What still blocks the claim

1. Production WordPress auth/session lifecycle is not proven on a live mutation boundary.
2. Preserved-remote retention after rejection is not proven, so manual resolution is not auditable retry authority.
3. Apply-time revalidation from fresh live hashes is not proven on the same mutation that produced the rejection.
4. Durable journal storage with lease/fencing is only proven in retained-source or lab harness form, not on production storage.
5. Graph identity under create-time remap is not proven for relationship-bearing WordPress rows and late-discovered records.
6. Plugin-driver coverage is not proven for plugin-owned surfaces outside the initial allowlist.
7. The design still leaves hidden-loss modes where partial file, DB, cache, cron, and plugin side effects can mix without a production recovery artifact that cleanly classifies what committed, what was blocked, and what must remain preserved for audit or retry.

## Hidden-loss scenarios

- If drift appears after dry-run and before apply, the remote must remain preserved and inspectable. There is no live proof of that rejection path here.
- If create-time remapping rewires identity, the mutation must either preserve graph identity or hard-block. There is no production proof of that behavior.
- If a plugin-owned option, table, cron row, cache entry, generated file, or activation side effect appears late, the push must classify it before any write lands and before any stale approval or cached retry can be reused. There is no coverage proof for that trap on a rerunnable live boundary.
- If a retry reuses stale manual-resolution text, it must not authorize a new mutation. The design does not yet show an auditable artifact that binds the approval to fresh live hashes and the preserved remote, so the retry path can still misrepresent a rejected remote as resolved.

## Source-note comparison

- Reprint source notes contribute staged transport and resumable-delivery lineage, but not live mutation safety, preserved-remote retry, or WordPress auth/session lifecycle proof on this branch.
- ZS-Sync source notes contribute discovery and batching lineage, but not source-mutation safety, create-time remap safety, or plugin-owned surface coverage on this branch.
- ForkPress source notes contribute audit and crash-consistency vocabulary, but not a live WordPress boundary with preserved-remote auditability, durable journal lease/fencing, or plugin-driver coverage on this branch.
- Any comparison to those notes must name the exact upstream revision or worktree state, say what the note proves here, and say what it does not prove here. If it only supports historical vocabulary, it stays provenance only and cannot be used as production proof by analogy.

## Changes required before production wording is defensible

Before the project can claim production-grade push support, one rerunnable live boundary must show all of the following on the same mutation:

- exact stale-drift rejection before the first write;
- preserved remote still inspectable after rejection;
- dry-run receipt plus apply-time revalidation on fresh live hashes;
- production WordPress auth/session lifecycle;
- durable journal storage with lease/fencing semantics;
- graph identity across create-time remaps and late-discovered relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces outside the initial allowlist; and
- retry scope rebuilt from fresh live evidence, not manual-resolution text, cached approvals, or previously rejected hashes.

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

If any one of those bullets is missing, the wording must stay in the lab/prototype bucket.

## Strongest blocker

This worktree still lacks one named, rerunnable live release command on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote, revalidates at apply time, and proves production WordPress auth/session lifecycle, durable journal storage plus lease/fencing, graph identity, and plugin-driver coverage on the same mutation.

Until that boundary exists, any production-grade push wording is false reliability, even though the supervised lane now has better retained-source evidence and an explicit auth/session lifecycle verdict. The current evidence still stops short of production proof because it does not show a preserved remote surviving rejection, a lease/fenced journal on production-like storage, or a rerunnable apply-time retry that can reject stale manual resolution.
