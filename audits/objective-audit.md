# Objective Audit

## Verdict

- Audited commit: `0512cd2792b1bda976ea0aeb0ff0ad55d9fcac19` (`Preserve packaged checked claim identities`)
- Previous audited reliable head: `9784566beb683509dde38c8e4c961ea58187ce14`
- Latest reliable diff reviewed: `9784566beb683509dde38c8e4c961ea58187ce14..0512cd2792b1bda976ea0aeb0ff0ad55d9fcac19`
- Reliable advanced since the supervisor baseline: `yes`
- Current critic head: `09a06d4dfc2aebeb3aa46369d22a45bd2dcd12bb`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 07:22:54 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `0512cd2792b1bda976ea0aeb0ff0ad55d9fcac19` (`Preserve packaged checked claim identities`)
  - `origin/lane/critic` -> `09a06d4dfc2aebeb3aa46369d22a45bd2dcd12bb` (`Classify reliable head 0512cd279`)
  - `origin/lane/independent-auditor` -> `25e783122daa3b59600e25d33aace7589b376d67` (`Audit reliable head 9784566b`)
  - `origin/lane/progress-publisher` -> `f35ff355caf43612f8ee35b8a80821a2c73749c7`
  - `origin/main` -> `1c7ccf9e8d5f6b6974f6ee4ceb92840d34391565`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Packaged checked claim identity preservation | `0512cd279` extends `scripts/playground/push-db-journal-lib.php` so the packaged journal summary now reconstructs the latest and previous claim rows, emits `claim`, `writerLease`, and `leaseFence.writerLease` fields with opaque `psh_...` claim ids plus 64-hex claim-key hashes, and marks the supported surface as `claim-fenced-restart-readable`. `scripts/playground/push-remote-rest-plugin.php` mirrors those `claimId` / `claimKeyHash` fields into packaged recovery-journal evidence. | Proof that the production-owned Reprint endpoint itself owns that checked claim state across live issuance, persistence, restart, and readback, rather than only surfacing it from packaged Playground support code. | Support-only |
| Packaged checked-boundary regression coverage | `test/production-shaped-proof.test.js` adds packaged proof assertions that both `recoveryInspect.journal` and `dbJournal` expose token-shaped `activeClaimId` / `writerLease.claimId` values and hashed `activeClaimKeyHash` / `writerLease.claimKeyHash` values on the checked packaged path. | Live production-endpoint evidence, not packaged verifier assertions, proving the real checked path preserves those identities through auth/session issuance, recovery-journal persistence, and readback. | Support-only |
| Live auth/session issuance and readback | The diff improves packaged checked-path visibility, but it still does not add a production-owned real Reprint endpoint that mints and reads back a live auth/session on the same checked boundary. | A checked real-endpoint run proving live auth/session issuance, preserved readback, and lifecycle ownership on that same boundary. | Blocked |
| Durable restart-readable journal ownership with lease fencing | The packaged summary now exposes more lease-fence metadata, including `supportedSurface`, `fsyncEvidence`, and mirrored `writerLease` claim identity fields. But the concrete evidence still comes from `scripts/playground/push-db-journal-lib.php` and `scripts/playground/push-remote-rest-plugin.php`, not a production-owned endpoint boundary. | Durable restart-readable journal ownership with lease fencing on the production-owned endpoint boundary itself. | Blocked |
| Playground readiness | This head does improve Playground/package readiness because the packaged checked-path proof can now read claim identity, writer lease, and lease-fence metadata consistently. | That is still package/Playground readiness only; it does not prove a production-owned boundary. | Support-only |
| Plugin-driver proof | No part of `0512cd279` adds plugin-driver ownership evidence or a real plugin-owned production mutation boundary. | Real boundary plugin-driver proof that preserves remote state and proves driver semantics on the release path. | Blocked |
| Preserved rejected-remote evidence | No part of `0512cd279` extends the proof that rejected remote state is durably preserved and auditable on the real endpoint. | Real boundary evidence that rejected remote state is preserved and auditable end to end. | Blocked |
| Apply-time revalidation before first mutation | No part of `0512cd279` proves the production-owned endpoint revalidates live state before the first mutation; the added coverage only hardens packaged checked-path evidence. | Real-endpoint apply-time revalidation before first mutation on the same production-owned boundary. | Blocked |
| Evidence quality | This commit is worthwhile checked-path hardening because it keeps packaged recovery-journal and DB-journal claim identity fields aligned and visible. It still remains support-only because the strongest evidence is packaged Playground code plus packaged proof assertions rather than an independently owned production endpoint. | Production ownership of auth/session lifecycle, journal storage, rejected-remote evidence, first-mutation revalidation, and plugin-driver behavior in one checked release command. | Support-only |

## Release Blockers

1. `0512cd279` fills in packaged checked claim identity fields, but the proof remains packaged support scoped.
2. The new evidence lives in `scripts/playground/push-db-journal-lib.php` and `scripts/playground/push-remote-rest-plugin.php`, so the boundary is still owned by Playground/package support code rather than a production-owned Reprint endpoint.
3. `test/production-shaped-proof.test.js` now verifies the packaged checked-path output more deeply, but it is still a packaged verifier assertion rather than live production boundary evidence.
4. There is still no checked live run proving auth/session issuance and later readback on that same production-owned boundary.
5. There is still no checked live run proving durable restart-readable journal ownership with lease fencing, Playground-independent plugin-driver behavior, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same production-owned boundary.

## Critic Alignment

The current critic verdict at `09a06d4dfc2aebeb3aa46369d22a45bd2dcd12bb` remains aligned with this audit. For `0512cd279`, both lanes agree that packaged checked-claim hardening is worthwhile but still support-only because the evidence remains packaged/Playground scoped (`scripts/playground/push-db-journal-lib.php`, `scripts/playground/push-remote-rest-plugin.php`, and packaged proof assertions in `test/production-shaped-proof.test.js`) instead of proving a production-owned endpoint boundary.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. plugin-driver ownership on the release boundary
4. preserved rejected-remote evidence
5. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
