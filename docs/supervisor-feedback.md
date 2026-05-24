# Supervisor Feedback

Last updated: 2026-05-24

This is the short feedback loop for the supervisor. Keep it focused on what
changed, what is helping, what is not helping, and the next nudge.

## 2026-05-24 - Evidence Checkpoint

### Going Well

- The public status surfaces still agree: the current proof is lab-scoped, and
  the production push claim remains blocked by missing endpoint, auth, durable
  journal, and storage-boundary evidence.
- The authenticated CLI smoke gives a useful command-shaped path for the next
  executor slice: snapshot, dry-run, apply, idempotency, replay, and
  changed-source refusal are all visible in one lab flow.
- Recovery and storage-guard evidence is no longer just design text. The lab
  now has DB journal, process-kill, missing-commit finalization, stale-claim,
  JIT drift, guarded DB write, and guarded upload-file write smokes.

### Not Going Well

- Progress is flat since the CLI refresh. No new production-shaped Reprint
  endpoint contract, credential binding, nonce/session cleanup, or durable
  production audit record has landed.
- WordPress graph safety is still under-proved. Posts, postmeta, attachments,
  taxonomy relationships, generated files, serialized options, multisite, and
  arbitrary plugin tables remain outside the current proof.
- Fast-path work is still documentation and model-level. There are no
  executable chunk cursors, transfer benchmarks, resume receipts, or memory
  ceilings for a large source site.

### Progress Delta

| Lane | Direction | Nudge |
| --- | --- | --- |
| No-data-loss invariants | Flat | Owner: no-data-loss invariants. Gap: WordPress graph identity. Next test: fixture with post, postmeta, attachment, taxonomy, and remote drift in one revalidated plan. |
| No-data-loss recovery | Flat after lab gains | Owner: no-data-loss recovery. Gap: production durability. Next test: kill at each DB/file boundary with DB journal evidence and old/new/blocked classification. |
| Reliable executor | Flat since CLI refresh | Owner: reliable executor. Gap: production route/auth contract. Next test: replace lab route names and auth assumptions with production-shaped Reprint preflight, dry-run, apply, nonce/session cleanup, and audit records. |
| Plugin data | Flat | Owner: no-data-loss invariants. Gap: arbitrary plugin state. Next test: one real plugin validator/driver beyond the allowlisted forms and atomic fixture plugins. |
| Fast paths | Flat | Owner: fast paths. Gap: executable chunking proof. Next test: large upload/table benchmark that preserves receipts, preconditions, journals, and resume cursors. |
| Independent audit and critic | Flat | Owner: independent auditor and critic. Gap: live integration behavior. Next test: re-audit the first production-shaped source mutation slice, not the lab aliases. |
| Progress publisher | Flat | Owner: progress publisher and feedback supervisor. Gap: page/log drift. Next test: keep the page to one-screen status and link the detailed evidence. |

### Next Supervisor Nudge

Ask reliable executor for a production-shaped endpoint contract before more
lab breadth: real Reprint route names, production credential binding, signed
preflight/dry-run/apply, nonce/session cleanup, one guarded DB row, one guarded
file, DB audit rows, same-key replay, different-body conflict refusal,
recovery inspect, and explicit rollback/blocking semantics.

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
  refusal before dry-run/apply.
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
| Reliable executor | Up in lab, blocked for production | Owner: reliable executor. Gap: real Reprint endpoint and credential binding. Next test: production-shaped CLI endpoint contract. |
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
