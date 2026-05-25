# Critic Audit

## Current verdict

This design still cannot claim production-grade push support.

The supervised reliable-executor lane now has material retained-source evidence: a `verify:release` lineage, `authSessionType`, minted session shape, `applyCommitted`, `durableJournal.rows: 17`, and an explicit `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` verdict. That is real progress, but it is still lab evidence. It does not prove a rerunnable live boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`, and it does not close the release gate for production auth/session lifecycle, durable journal semantics, graph identity, preserved-remote retention, or plugin-driver coverage.

## What still blocks the claim

1. Production WordPress auth/session lifecycle is not proven on a live mutation boundary.
2. Preserved-remote retention after rejection is not proven, so manual resolution is not auditable retry authority.
3. Apply-time revalidation from fresh live hashes is not proven on the same mutation that produced the rejection.
4. Durable journal storage with lease/fencing is only proven in retained-source or lab harness form, not on production storage.
5. Graph identity under create-time remap is not proven for relationship-bearing WordPress rows and late-discovered records.
6. Plugin-driver coverage is not proven for plugin-owned surfaces outside the initial allowlist.
7. The design still leaves hidden-loss modes where partial file, DB, and plugin side effects can mix without a production recovery artifact that cleanly classifies what committed and what was blocked.

## Hidden-loss scenarios

- If drift appears after dry-run and before apply, the remote must remain preserved and inspectable. There is no live proof of that rejection path here.
- If create-time remapping rewires identity, the mutation must either preserve graph identity or hard-block. There is no production proof of that behavior.
- If a plugin-owned option, table, cron row, cache entry, generated file, or activation side effect appears late, the push must classify it before any write lands. There is no coverage proof for that trap.
- If a retry reuses stale manual-resolution text, it must not authorize a new mutation. The design does not yet show an auditable artifact that binds the approval to fresh live hashes and the preserved remote.

## Source-note comparison

- Reprint contributes staged transport and resumable-delivery lineage, but not live mutation safety, preserved-remote retry, or auth/session proof on this branch.
- ZS-Sync contributes discovery and batching lineage, but not source-mutation safety, identity remap safety, or plugin-owned surface coverage on this branch.
- ForkPress contributes audit and crash-consistency vocabulary, but the source notes still do not prove a live WordPress boundary with preserved-remote auditability, lease/fencing, or plugin-driver coverage on this branch.

## Changes required before production wording is defensible

Before the project can claim production-grade push support, one rerunnable live boundary must show all of the following on the same mutation:

- exact stale-drift rejection before the first write;
- preserved remote still inspectable after rejection;
- dry-run receipt plus apply-time revalidation on fresh live hashes;
- production WordPress auth/session lifecycle;
- durable journal storage with lease/fencing semantics;
- graph identity across create-time remaps and late-discovered relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces outside the initial allowlist; and
- retry scope rebuilt from fresh live evidence, not manual-resolution text.

Manual resolution is not success unless the remote is preserved, the retry is auditable, and the exact boundary can be replayed safely.

## Strongest blocker

This worktree still lacks one named, rerunnable live release command on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected remote, revalidates at apply time, and proves production WordPress auth/session lifecycle, durable journal storage plus lease/fencing, graph identity, and plugin-driver coverage on the same mutation.

Until that boundary exists, any production-grade push wording is false reliability, even though the supervised lane now has better retained-source evidence and an explicit auth/session lifecycle verdict.
