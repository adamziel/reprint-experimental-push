# Critic Audit

## Current verdict

This design still cannot claim production-grade push support.

The supervised reliable-executor lane now has material retained-source evidence: remote `verify:release` lineage, `authSessionType`, minted session shape, `applyCommitted`, `durableJournal.rows: 17`, the `PRODUCTION_AUTH_SESSION_LIFECYCLE_REQUIRED` verdict, the `7e0f27f2` production-shaped apply-revalidation proof bound to the supplied source URL, and remote head `ec1c9952` surfacing protocol extension plus the earlier `0c703230` snapshot-hash proof. That is real progress, but it is still retained-source lab evidence. It does not yet prove one rerunnable live WordPress mutation boundary on one exact source URL that preserves the rejected remote, re-enters the same auth/session after rejection, revalidates at apply time from fresh live hashes, writes through a lease-fenced durable journal on production-like storage, preserves graph identity under create-time remap, and covers late plugin-owned surfaces before the first write.

The single blocker is still one rerunnable live mutation boundary on one exact source URL. Until that boundary preserves the rejected remote, re-derives authority from fresh live hashes at apply time, re-enters the same WordPress auth/session after rejection, and classifies plugin-owned surfaces before the first write, production wording stays false.

The missing production proof is one rerunnable live mutation boundary on one exact source URL. That boundary must preserve the rejected remote, re-derive authority from fresh live hashes at apply time, and classify every touched row, file, relationship-bearing record, and plugin-owned surface before the first write. Until that exists, the retained-source proofs remain useful but non-production evidence. A wording change on this branch does not close the gap unless the remote lane shows the preserved rejected remote surviving refusal on that same live boundary, with the rejected source still inspectable after refusal and the auth/session state re-entered on that same rerunnable boundary.

What must happen before production wording is defensible:

- preserve the rejected remote after refusal and keep it inspectable for audit and retry on the same rerunnable live boundary;
- re-derive authority from fresh live hashes at apply time on that same boundary;
- prove WordPress auth/session expiry, refresh, and operator re-entry on the rejected source URL;
- write through a lease-fenced durable journal on production-like storage, not just report row counts;
- preserve graph identity across create-time remap and late-discovered relationship-bearing records; and
- classify late plugin-owned surfaces before the first write, not after a manual review artifact exists.

The project still lacks production proof for these concrete failure modes:

- a live mutation can be rejected, but the rejected remote is lost or overwritten before audit or retry;
- a retry reuses stale manual-resolution text instead of fresh live hashes from the same source URL;
- WordPress auth/session minting works in lab output, but expiry, refresh, and operator re-entry on the live source URL are not proven;
- journal rows exist, but the storage layer is not shown to be lease-fenced or crash-safe on production-like storage;
- create-time remap can silently break graph identity for relationship-bearing records or later-discovered records;
- plugin-owned tables, options, cron rows, caches, generated files, serialized blobs, or runtime registries can appear after the first write and escape the initial allowlist.

The upstream source notes remain provenance only until the same live boundary is rerun here:

- Reprint can justify staged transport and resumability vocabulary, but not preserved-remote retention, auth/session re-entry, or apply-time revalidation on the same live boundary;
- ZS-Sync can justify bounded discovery and cursoring vocabulary, but not create-time remap safety, graph identity, or plugin-owned surface coverage on the same live boundary; and
- ForkPress can justify audit and crash-consistency vocabulary, but not lease-fenced durability, preserved-remote auditability, or retry authority on the same live boundary.

Treat those notes as source notes for vocabulary only. They do not prove the live WordPress auth/session lifecycle, durable journal storage plus lease/fencing, preserved rejected-remote retention after refusal, apply-time revalidation, graph identity, or plugin-driver coverage on the same rerunnable boundary.

Conservatively, the comparison is:

- Reprint proves there is a staged push vocabulary and a retained-source compatibility harness, not a production retry boundary with preserved-remote auditability.
- ZS-Sync proves bounded discovery language, not create-time remap identity or late plugin-owned surface coverage.
- ForkPress proves review/crash-consistency language, not lease-fenced journal durability or preserved rejected-remote retry authority.

If this branch lacks a command, file, or note that the supervised remote already has, treat that as a branch-local merge gap. Do not upgrade the release claim because of that local gap; the gate only opens when the same rerunnable live boundary exists and preserves the rejected remote.
The supervised remote already improved the command surface and retained-source release verification, so the critique must not fall back to "no `verify:release` exists." The missing proof is the production WordPress boundary itself: live auth/session lifecycle, preserved-remote retention after rejection, lease-fenced durable journal semantics, create-time remap graph identity, and plugin-driver coverage all on one rerunnable live mutation.
The remote lane's retained-source `verify:release` progress still counts as lab evidence, but it does not become production proof until the live WordPress boundary shows preserved-remote retention, fresh apply-time revalidation, lease/fenced journal semantics, graph identity, and plugin-driver coverage together.

## False reliability claims

The following should not be described as production-grade until they are proven on the same rerunnable live boundary:

- manual resolution text that does not leave the rejected remote preserved and inspectable;
- reviewer notes or stale approval text that are not bound to the preserved remote and fresh live hashes on the same rerunnable boundary;
- auth/session minting without a live WordPress expiry, refresh, nonce or credential renewal, and operator re-entry cycle on the same source URL that was rejected;
- durable journal row counts without lease/fencing on production-like storage;
- graph identity claims without create-time remap coverage and late-discovered relationship-bearing records; and
- plugin support claims without coverage for late plugin-owned surfaces that fall outside the initial allowlist.

The presence of `verify:release` on the supervised remote lane is accepted as real lab progress, so command shape is no longer the blocker. Do not regress to "no release command exists" wording on this branch; the blocker is that the same rerunnable live boundary has not yet demonstrated production WordPress auth/session lifecycle, preserved-remote retention after rejection, durable journal lease/fencing on production-like storage, graph identity under create-time remap, and plugin-driver coverage together.

The next proof has to be a real rerunnable live boundary, not another retained-source milestone: the same rejected remote must stay preserved and inspectable, the same source URL must re-enter with fresh live hashes at apply time, and the same boundary must show auth/session expiry, refresh, operator re-entry, journal lease/fencing, graph identity, and plugin-driver coverage together.

## Release gate reminder

The retained-source `verify:release` run, minted session shape, and apply-revalidation proof are useful evidence, but they are still not the release gate. The release gate only opens when one rerunnable live boundary on one exact source URL preserves the rejected remote, revalidates from fresh live hashes at apply time, survives auth/session expiry and re-entry, writes through a lease-fenced durable journal, preserves graph identity across remap, and classifies late plugin-owned surfaces before the first write.

Reprint, ZS-Sync, and ForkPress remain provenance, not retry authority. Reprint explains staged transport and resumability; ZS-Sync explains bounded discovery and cursoring; ForkPress explains merge-audit and crash-consistency vocabulary. None of them prove the missing branch-local live boundary, and none of them justify production wording here unless the same live mutation was rerun on this worktree with the rejected remote preserved.
The source notes are also not a substitute for the supervised remote's retained-source evidence: they can explain terminology, but they do not prove preserved-remote retention, apply-time revalidation, auth/session re-entry, lease/fenced storage, graph identity, or plugin-driver coverage on the live boundary that production wording requires.

If the upstream notes are cited, they must be framed as source notes for vocabulary only:

- Reprint can justify staged transport and resumability language, but not preserved-remote retention, auth/session re-entry, or apply-time revalidation on the same live boundary.
- ZS-Sync can justify bounded discovery and cursoring language, but not create-time remap safety, graph identity, or plugin-owned surface coverage on the same live boundary.
- ForkPress can justify audit and crash-consistency language, but not lease/fenced durability, preserved-remote auditability, or retry authority on the same live boundary.

## Immediate blocker for release wording

The only acceptable transition to production wording is one rerunnable live WordPress boundary that proves all of these together:

- rejected remote preserved and auditable after refusal;
- fresh live hashes re-derived at apply time on the same boundary;
- auth/session expiry, refresh, and operator re-entry on the same source URL;
- durable journal storage with lease/fencing on production-like storage;
- graph identity preserved across create-time remap and late-discovered relationship-bearing records; and
- plugin-driver coverage for late plugin-owned surfaces outside the initial allowlist.

If any of those are only shown in retained-source harness output, the release claim stays false.

Reprint, ZS-Sync, and ForkPress only supply provenance for transport, discovery, and crash-consistency vocabulary. Reprint is closest on resumable transport and staged delivery; ZS-Sync is closest on discovery and batching; ForkPress is closest on audit and crash-consistency language. None of them prove the missing production boundary here. Their observed anchors (`27c5f25`, `d9334a0`, `55f9879`) are useful context, but they are not retry authority: they do not prove preserved-remote retention after rejection, stale-authority rejection before the first write, live auth/session lifecycle, lease/fenced durability, graph identity, or plugin-driver coverage on this branch.

The next production proof must be one rerunnable live boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL`: preserve the rejected remote, reject stale authority before the first write, rebuild authority from fresh live hashes at apply time, and keep the same live mutation boundary rerunnable while real WordPress auth/session state, lease-fenced journal storage, graph identity, and plugin-driver coverage are all proven together on that same boundary.

## What still blocks the claim

1. Production WordPress auth/session lifecycle is not proven on a live mutation boundary, including expiry, refresh, and operator re-entry after rejection.
2. Preserved-remote retention after rejection is not proven on the same live boundary, so manual resolution is not auditable retry authority and cannot be reused as a later boundary's approval.
3. Apply-time revalidation from fresh live hashes is not proven on the same mutation that produced the rejection, so stale approval can still masquerade as retry authority.
4. Durable journal storage with lease/fencing is only proven in retained-source or lab harness form, not on production-like storage that survives rejection and retry.
5. Graph identity under create-time remap is not proven for relationship-bearing WordPress rows and late-discovered records.
6. Plugin-driver coverage is not proven for plugin-owned surfaces outside the initial allowlist.
7. Partial file, DB, cache, cron, and plugin side effects can still mix without a recovery artifact that says what committed, what was blocked, what stayed preserved, and what must be retried.
8. There is still no single rerunnable live boundary that proves preserved-remote retention, stale-authority rejection before the first write, apply-time revalidation from fresh hashes, graph identity, and late plugin-owned surface coverage together.
9. The journal has not been proven to survive a real lease/fencing handoff on durable storage while the same boundary remains rerunnable after rejection.
10. The reliable lane’s auth/session evidence stops at retained-source minting and verdicts plus a production-shaped apply-revalidation proof; `4baf67ab` only aligns the release assertions, and `0c703230` only surfaces remote snapshot hashes. It does not yet prove a live WordPress session lifecycle that survives the same rejection/retry boundary as the mutation, including credential expiry, refresh, and operator re-entry on the same rerunnable source URL with the rejected remote preserved.
11. No retained-source verdict should be treated as production-grade if it does not survive a rerunnable live mutation on the same source URL with the rejected remote still inspectable and auditable for retry.

## Hidden-loss scenarios

- If drift appears after dry-run and before apply, the remote must remain preserved and inspectable. There is no live proof of that rejection path here, so the design still cannot prove safe audit or safe retry after rejection.
- If create-time remapping rewires identity, the mutation must either preserve graph identity or hard-block. There is no production proof of that behavior, so late-discovered relationship-bearing records can still drift out of the intended graph.
- If a plugin-owned option, table, cron row, cache entry, generated file, or activation side effect appears late, the push must classify it before any write lands and before any stale approval or cached retry can be reused. There is no coverage proof for that trap on a rerunnable live boundary, so plugin-driver behavior can still silently miss writes outside the initial allowlist.
- If a retry reuses stale manual-resolution text, it must not authorize a new mutation. The design does not yet show an auditable artifact that binds the approval to fresh live hashes and the preserved remote, so the retry path can still misrepresent a rejected remote as resolved.
- If a retry boundary can be rerun but does not re-derive authority from the fresh live remote state at apply time, then the boundary is still a lab replay, not production retry authority.
- If a rerunnable boundary proves auth/session minting but not expiry, refresh, and operator re-entry on the same rejected source URL, then the evidence still stops at lab harness behavior.
- If the conflict policy is left to "manual resolution" without preserved-remote retention, fresh-hash revalidation, and a blocked/new/retained classification for each touched surface, then the policy is ambiguous and can silently widen scope.
- If the remote is rejected but not preserved, the workflow cannot support safe audit or safe retry, so "manual resolution" remains a label, not proof.
- If a live boundary does not rerun on the same source URL after rejection, then preserved-remote retention, fresh-hash revalidation, and plugin-driver coverage are still disconnected proofs and cannot authorize production wording.
- If a live boundary does not rerun on the same source URL after rejection, then preserved-remote retention, fresh-hash revalidation, graph identity, and plugin-driver coverage are still disconnected proofs and cannot authorize production wording.
- If the auth/session lifecycle is only demonstrated in retained-source harness output, the design still has no proof that a real WordPress session, nonce, credential refresh, expiry, or operator re-entry survives the same rejection and retry semantics as the push itself.

## Source-note comparison

Treat the three source-note families as historical context, not retry authority:

- Reprint (`27c5f25`) proves resumable transport and staged delivery vocabulary only. It does not prove a live mutation boundary, preserved-remote retention after rejection, or WordPress auth/session lifecycle on this branch.
- ZS-Sync (`d9334a0`) proves discovery and batching vocabulary only. It does not prove source-mutation safety, create-time remap safety, graph identity, or plugin-owned surface coverage on this branch.
- ForkPress (`55f9879`) proves audit and crash-consistency vocabulary only. It does not prove a live WordPress boundary, durable journal lease/fencing, preserved-remote auditability, or plugin-driver coverage on this branch.

If a summary tries to turn those notes into retry authority without a branch-local rerun of the same live boundary, it is a wording leak rather than evidence.

None of the three source-note sets prove live push safety on this branch, and none should be read as production evidence without the rerunnable live boundary described above.
The missing proof is still one rerunnable live mutation on one exact source URL with preserved-remote retention, apply-time revalidation, auth/session lifecycle, durable journal lease/fencing, graph identity, and plugin-driver coverage all observed together. The remote `4096f3ac` drift-rejection proof and `7e0f27f2` apply-revalidation proof are useful, but they remain separate retained-source steps until the same live boundary preserves the rejected remote and survives retry on production-like state. The current `4baf67ab` verdict is useful release-boundary evidence, and `0c703230` adds remote snapshot hashes, but neither proves the full production WordPress boundary.

## Changes required before production wording is defensible

Before the project can claim production-grade push support, one rerunnable live boundary must show all of the following on the same mutation:

- exact stale-drift rejection before the first write;
- preserved remote still inspectable after rejection and usable for audit, with the rejected source URL remaining available for replay review;
- dry-run receipt plus apply-time revalidation on fresh live hashes;
- production WordPress auth/session lifecycle, including expiry, refresh, and operator re-entry on the same live source URL;
- durable journal storage with lease/fencing semantics on production-like storage;
- graph identity across create-time remaps and late-discovered relationship-bearing records;
- plugin-driver coverage for late-discovered plugin-owned surfaces outside the initial allowlist; and
- retry scope rebuilt from fresh live evidence, not manual-resolution text, cached approvals, or previously rejected hashes.

If any one of those proofs is only available through retained-source lab output, the release claim remains false.

The shortest acceptable production gate is one rerunnable live WordPress release boundary with a preserved rejected remote, fresh-live-hash apply-time revalidation, lease-fenced journal writes on production-like storage, graph/plugin classification before the first write, and an auditable retry path that preserves the rejected remote after refusal. Until those appear together, retained-source `verify:release` output stays useful but insufficient.

The branch-local audit file may document the critique, but it cannot stand in for the missing live boundary. A retained-source `verify:release` run, a minted session shape, or a release-boundary verdict is still not enough unless the rejected remote survives the refusal and can be re-audited on the same live source URL.

The production claim also fails closed if any of these are only shown on a lab fixture, retained-source harness, or review artifact:

- auth/session lifecycle shape without a live remote boundary;
- journal rows without storage and lease/fencing behavior on production-like storage;
- graph identity without create-time remap and late-discovered relationship-bearing record coverage;
- plugin-driver behavior without a rerunnable boundary on a real source URL that can reclassify late plugin-owned writes; or
- preserved-remote wording without the rejected remote still being inspectable after rejection.

Manual resolution is not success unless the remote is preserved after rejection, the retry is auditable against fresh live hashes, and the exact boundary can be replayed safely. A reviewer note or retained-source verdict without that preserved remote is not retry authority.

## Must-happen proof

The next acceptable proof is one rerunnable live mutation boundary on one exact source URL, not another wording pass:

- the rejected remote is preserved and still inspectable after refusal;
- apply-time revalidation runs from fresh live hashes on the same boundary;
- live WordPress auth/session lifecycle survives the same rejection/retry flow, including expiry and refresh;
- durable journal storage uses lease/fencing on production-like storage and survives the handoff;
- graph identity holds across create-time remap and late-discovered relationship-bearing records; and
- plugin-driver coverage catches late plugin-owned surfaces outside the initial allowlist.

Without that single boundary, manual resolution stays a label, not retry authority.

The source-note comparisons stay historical until that same boundary is rerun here with the rejected remote preserved and inspectable; route shape, package layout, and reviewer wording are not substitute evidence for live retry authority.

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
Any claim that relies on manual resolution, cached approval text, or a retained-source verdict without a rerunnable live boundary is false reliability. The preserved remote must remain inspectable after rejection, or the claim is not auditable retry authority.

If any one of those bullets is missing, the wording must stay in the lab/prototype bucket.

Use the upstream notes conservatively:

- Reprint can justify transport, staged delivery, and resumability vocabulary, but it does not prove live push safety, preserved-remote retention, or stale-drift rejection here.
- ZS-Sync can justify bounded discovery and cursoring vocabulary, but it does not prove source-mutation safety, graph identity, or plugin-owned surface coverage here.
- ForkPress can justify review and crash-consistency vocabulary, but it does not prove retry authority, preserved-remote auditability, or authority over a later live boundary discovered after rejection.

Any stronger reading of those notes is false reliability until this branch reruns the same live boundary and preserves the rejected remote.

## Exact next proof

The next acceptable proof is one rerunnable live WordPress mutation on one exact source URL that:

- rejects stale authority before the first write;
- keeps the rejected remote preserved and inspectable;
- revalidates from fresh live hashes at apply time;
- survives auth/session expiry, refresh, and operator re-entry on the same boundary;
- commits through a lease-fenced journal on production-like storage;
- preserves graph identity across create-time remap and late-discovered relationship-bearing records; and
- classifies late plugin-owned surfaces outside the initial allowlist on that same boundary.

Until that boundary exists, `verify:release`, retained-source verdicts, and the current release-boundary head remain useful lab evidence only.

If the next worker can only produce wording, local fixture output, or a manual-resolution artifact, that is not enough. The proof must leave the rejected remote preserved for audit and retry.

## Strongest blocker

The strongest blocker is still one named, rerunnable live release boundary on a real local, Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that rejects stale authority before the first write, preserves the rejected remote for audit, revalidates at apply time from fresh live hashes, and proves production WordPress auth/session lifecycle, durable journal storage plus lease/fencing on production-like storage, graph identity, and plugin-driver coverage on the same mutation.

That boundary must include auth/session expiry, refresh, and operator re-entry on the same source URL that was rejected, not just retained-source minting or a verdict string. Until that boundary exists, any production-grade push wording is false reliability, even though the supervised lane now has better retained-source evidence, a release-verification script on the remote branch, and an explicit auth/session lifecycle verdict. The current evidence still stops short of production proof because it does not show a preserved remote surviving rejection, stale authority blocked before the first write, a lease/fenced journal on production-like storage, graph identity under create-time remap, plugin-driver coverage for late-discovered surfaces, or a rerunnable apply-time retry that can reject stale manual resolution on the same live source URL.
