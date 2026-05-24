# Supervisor Feedback

Last updated: 2026-05-24 22:04 CEST

This is the short feedback loop for the supervisor. Keep it focused on what
changed, what is helping, what is not helping, and the next nudge.

## 2026-05-24 - Current Nudge

- Going well: `70` Node tests pass, and
  `npm run test:playground:production-shaped-push` proves the lab-backed
  `/wp-json/reprint/v1/push/*` route slice.
- Not going well: production readiness is flat. The repo still lacks a
  production endpoint, credential binding, nonce cleanup, durable audit,
  storage guard, and general plugin driver proof.
- Progress change: reliable executor moved up in lab-backed route proof;
  production evidence did not.
- Next nudge: package the route as a production endpoint with real auth/session
  cleanup and durable journal guarantees.

| Lane | Change | Next nudge |
| --- | --- | --- |
| Invariants | Up in lab | Prove real WordPress graph identity and drift handling. |
| Recovery | Up in lab | Prove production DB journal durability and crash boundaries. |
| Reliable executor | Up in lab route proof | Package the production endpoint and durable journal path. |
| Fast paths | Up in model | Run a large-site benchmark with receipts and resume cursors. |
| Audit and critic | Up | Re-audit the first executable production-shaped mutation slice. |
| Progress publisher | Synced | Keep Pages aligned and concise. |

<details>
<summary>Earlier feedback entries</summary>

## 2026-05-24 - Evidence Checkpoint

### Going Well

- Status surfaces agree and stay lab-scoped.
- The CLI lab now covers snapshot, dry-run, apply, replay, changed-source
  refusal, and post-snapshot drift refusal.
- Recovery, guarded DB/file writes, forms data, and atomic plugin fixtures have
  executable smoke coverage.

### Not Going Well

- Production readiness is flat: no Reprint mutation endpoint, credential
  binding, nonce/session cleanup, or durable production audit record.
- WordPress graph and plugin safety remain fixture-scoped.
- Fast paths still lack executable chunk cursors and large-site benchmarks.

### Progress Delta

| Lane | Direction | Nudge |
| --- | --- | --- |
| No-data-loss invariants | Flat | Next: one WordPress graph fixture with post, postmeta, attachment, taxonomy, and drift. |
| No-data-loss recovery | Flat after lab gains | Next: kill each DB/file boundary with durable journal evidence. |
| Reliable executor | Up in lab, flat in production | Next: production-shaped Reprint route/auth/audit/recovery contract. |
| Plugin data | Flat | Next: one real plugin validator beyond fixture allowlists. |
| Fast paths | Flat | Next: chunked large-site benchmark with receipts and resume cursors. |
| Audit lanes | Flat | Next: re-audit the first production-shaped source mutation slice. |
| Progress publisher | Up | Next: keep the page one-screen and link details. |

### Next Supervisor Nudge

Ask reliable executor for the next proof: production-shaped Reprint route names,
credential binding, signed preflight/dry-run/apply, nonce cleanup, audit rows,
same-key replay, different-body conflict refusal, and recovery inspect.

## 2026-05-24 - CLI Push Refresh

### Going Well

- The evidence trail is more consistent: progress page, progress log,
  objective audit, critic audit, and feedback notes all keep the production
  push claim blocked by missing evidence.
- Lab hard-failure coverage improved: DB journal replay, missing-commit
  finalization, all-old stale-claim retry, JIT drift refusal, and
  storage-boundary DB/file refusal are linked from the status surfaces.
- The source-site path is now command-driven in the lab. The authenticated CLI
  smoke proves non-mutating dry-run, DB-journaled apply, and changed-source
  refusal before dry-run/apply. It now also proves post-snapshot source drift
  is caught by authenticated dry-run before apply.
- Fixture plugin/data safety is less hand-wavy: forms fixture data, one custom
  table driver, and hard-coded fixture plugin install atomicity now have
  allowlisted proof.

### Not Going Well

- Production source-site mutation is still blocked. There is no production
  Reprint endpoint, production credential binding, production durable audit
  record, or production storage guard.
- Recovery is still lab-scoped. SQLite/host-mount, JSONL model, and option/DB
  lab journals do not prove production DB durability, filesystem `fsync`,
  locks, leases, rollback, or exactly-once writes.
- Plugin safety remains allowlist-scoped. Arbitrary serialized options,
  activation hooks, custom tables, generated data, and rollback remain blocked
  by missing validators.
- Fast paths are still design-level. There are no large-site transfer
  benchmarks, chunk cursors, memory ceilings, or resume proofs.

### Progress Delta

| Lane | Direction | Nudge |
| --- | --- | --- |
| No-data-loss invariants | Up | Owner: no-data-loss invariants. Gap: WordPress graph identity. Next test: post, postmeta, attachment, taxonomy, and remote drift. |
| No-data-loss recovery | Up | Owner: no-data-loss recovery. Gap: production durability. Next test: kill apply at each DB/file boundary and classify old/new/blocked. |
| Reliable executor | Up in lab, blocked for production | Owner: reliable executor. Gap: real Reprint endpoint and credential binding. Next test: production-shaped CLI endpoint contract with the same post-snapshot drift refusal. |
| Plugin data | Up in fixtures, blocked generally | Owner: no-data-loss invariants. Gap: arbitrary plugin state. Next test: one real plugin validator/driver beyond the forms fixture. |
| Fast paths | Flat | Owner: fast paths. Gap: executable chunking proof. Next test: large upload/table benchmark with receipts, preconditions, journals, and recovery. |
| Independent audit and critic | Flat | Owner: independent auditor and critic. Gap: live integration behavior. Next test: re-audit the first production-shaped source mutation slice. |
| Progress publisher | Up | Owner: progress publisher and feedback supervisor. Gap: page/log drift. Next test: keep one-screen status linked to detailed caveats. |

### Next Supervisor Nudge

Turn the authenticated CLI lab path into a production-shaped endpoint contract:
real Reprint route names, production credential binding, nonce/session cleanup,
one guarded DB row, one guarded file, DB journal evidence, same-key replay,
different-body conflict refusal, recovery inspect, and explicit
rollback/blocking semantics.

## 2026-05-24 - Initial Feedback

### Going Well

- No-data-loss recovery evidence improved: DB stale-claim retry now has a
  local Playground proof, and fixture upload file update/create/delete writes
  now fail closed at the storage boundary.
- The lab now has clearer replay behavior: same key/body replays without fresh
  mutation work; same key/different body conflicts before mutation.
- The project status page is shorter and links out to detailed evidence instead
  of embedding the full audit in the first view.

### Not Going Well

- The work is still lab-scoped. There is no production Reprint HTTP mutation
  endpoint, production auth binding, production DB journal, or production
  filesystem durability proof.
- Plugin data remains fixture/allowlist-scoped. Arbitrary serialized options,
  plugin tables, activation hooks, and rollback are not solved.
- The progress surface was too verbose; future updates should add links and
  one-line deltas, not long proof paragraphs.

### Progress Delta

| Lane | Direction | Nudge |
| --- | --- | --- |
| No-data-loss recovery | Up | Keep expanding crash-boundary tests from lab hooks toward production-style WordPress writes. |
| Reliable executor | Flat | Next useful proof is a real source-site mutation endpoint with production-shaped auth and journal records. |
| Fast paths | Flat | Do not optimize until chunking keeps receipts, preconditions, and recovery cursors intact. |
| Plugin data | Flat | Add one realistic plugin validator/driver beyond the forms fixture before claiming semantic safety. |
| Progress publisher | Up | Keep the HTML page concise; put detailed evidence in Markdown docs. |

### Next Supervisor Nudge

Prioritize a production-shaped source-site mutation slice: authenticated
preflight, dry-run receipt, one guarded DB row update, one guarded file write,
DB journal evidence, and replay/conflict behavior over a real local WordPress
site. Keep the scope small, but make the boundary production-shaped.

</details>
