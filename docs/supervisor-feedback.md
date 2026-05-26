# Supervisor Feedback

Last updated: 2026-05-26 13:03 CEST

This is the short feedback loop for the supervisor. Keep it focused on what
changed, what is helping, what is not helping, and the next nudge.

## 2026-05-26 13:03 CEST - Reliable Head Catch-Up

- Going well: `3a64aef6773c3c82ad3a5b91a6ea0ca53c3942fb` is now the current
  reliable head, so the public status is current again for the latest
  auth-session cleanup/revocation evidence.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a freshness update only; no gate moved.
- Next nudge: keep `progress-publisher` conservative and keep
  `reliable-executor` on the next production-boundary proof: durable-journal
  consumption, live release-path lifecycle, or preserved-remote retry.

## 2026-05-26 13:02 CEST - Reliable Head Catch-Up

- Going well: `35687102` is now the current reliable head, so the public
  status is back in sync with the latest auth-session cleanup/revocation
  evidence.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a freshness update only; no gate moved.
- Next nudge: keep `progress-publisher` conservative and keep
  `reliable-executor` on the next production-boundary proof: durable-journal
  consumption, live release-path lifecycle, or preserved-remote retry.

## 2026-05-26 13:00 CEST - Reliable Head Catch-Up

- Going well: `f091d30c` adds more auth-session cleanup and revocation
  evidence in the reliable lane, so the product-side proof is still moving
  forward.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is another evidence update, not a gate move.
- Next nudge: keep `progress-publisher` conservative if the public page lags,
  and keep `reliable-executor` on the next production-boundary proof:
  durable-journal consumption, live release-path lifecycle, or preserved-
  remote retry.

## 2026-05-26 12:59 CEST - Auth Cleanup/Revoke Head

- Going well: `f091d30c` adds more concrete auth-session lifecycle evidence in
  the reliable lane, with the package-mode route/auth/journal checks still
  moving in a bounded direction.
- Not going well: the evidence still stops short of the checked release path's
  production-backed auth/session lifecycle and durable-journal ownership, so
  the gate stays `0/4`.
- Progress change: this is a product-side evidence update, not a gate move.
- Next nudge: keep `progress-publisher` conservative if the public page is
  stale, and keep `reliable-executor` on the next production-boundary proof:
  durable-journal consumption, live release-path lifecycle, or preserved-remote
  retry.

## 2026-05-26 12:56 CEST - Reliable Head Catch-Up

- Going well: the public status is now aligned with `35687102`, so the
  freshness gap is closed again.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a visibility refresh, not a gate move.
- Next nudge: keep `progress-publisher` aligned with the current reliable head
  and keep `reliable-executor` on the next production-boundary dependency.

## 2026-05-26 12:55 CEST - Reliable Head Catch-Up

- Going well: the public status is now aligned with `35687102`, so the
  freshness gap is closed again.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a visibility refresh, not a gate move.
- Next nudge: keep `progress-publisher` aligned with the current reliable head
  and keep `reliable-executor` on the next production-boundary dependency.

## 2026-05-26 12:50 CEST - Reliable Head Catch-Up

- Going well: the public status is now aligned with `bb6c1378`, so the
  freshness gap is closed again.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a visibility refresh, not a gate move.
- Next nudge: keep `progress-publisher` aligned with the current reliable head
  and keep `reliable-executor` on the next production-boundary dependency.

## 2026-05-26 12:48 CEST - Reliable Head Catch-Up

- Going well: the public status is now aligned with `b4177b34`, so the
  freshness gap is closed again.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a visibility refresh, not a gate move.
- Next nudge: keep `progress-publisher` aligned with the current reliable head
  and keep `reliable-executor` on the next production-boundary dependency.

## 2026-05-26 12:46 CEST - Reliable Head Catch-Up

- Going well: the public status is now catching up to `b4177b34`, so the
  freshness gap is narrower than before.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle and durable-journal ownership, so the gate stays
  `0/4`.
- Progress change: this is a visibility refresh, not a gate move.
- Next nudge: keep `progress-publisher` aligned with the current reliable head
  and keep `reliable-executor` on the next production-boundary dependency.

## 2026-05-26 12:44 CEST - Package-Mode Head Correction

- Going well: the current reliable head is `a33aa3da`, and the package-mode
  patch now surfaces `labBacked: false`, `production-auth-session`, and
  packaged journal scope evidence in the package smoke.
- Not going well: the bounded smoke still timed out during Playground boot, so
  the new package-mode assertions remain unverified end to end.
- Progress change: the public surfaces now match the latest package-mode head
  and stay conservative at `0/4` while the package-mode patch remains dirty.
- Next nudge: either shorten the boot/readiness path enough to validate the
  new assertions, or name the exact Playground boot/API blocker instead of
  rerunning the same full smoke.

## 2026-05-26 12:39 CEST - Package-Mode Boundary Still Bounded

- Going well: the package-mode patch now distinguishes the packaged
  `reprint/v1` surface from the lab-backed path with `labBacked: false`,
  `production-auth-session`, and packaged journal scope evidence.
- Not going well: the bounded smoke still has not completed, so the new
  package-mode assertions are not yet validated end to end.
- Progress change: the implementation has moved from lab-backed wording to a
  production-package signal set, but the proof remains blocked by startup
  time rather than a passing run.
- Next nudge: either shrink the boot/readiness path enough to exercise the new
  assertions, or report the exact Playground boot/API blocker instead of
  rerunning the same full smoke.

## 2026-05-26 12:37 CEST - Package-Mode Assertion Tightening

- Going well: the package smoke now checks the production-package route
  profile, auth session type, and DB journal scope instead of only the route
  name.
- Not going well: the long boot path still needs a bounded proof run, so the
  package-mode result is not yet validated end to end.
- Progress change: the patch now distinguishes packaged mode with
  `labBacked: false`, `production-auth-session`, and packaged journal scope
  evidence.
- Next nudge: run the smallest bounded package smoke proof that exercises
  those assertions, or report the exact Playground boot/API blocker if it
  still stalls.

## 2026-05-26 12:36 CEST - Package-Mode Route Signals

- Going well: the dirty package-mode patch is now pulling the checked
  `reprint/v1` path toward production-package evidence instead of lab-backed
  wording.
- Not going well: the smoke still timed out while Playground booted, so the
  new package-mode assertions have not been exercised end to end yet.
- Progress change: the route profile, auth session, and DB journal evidence
  are being narrowed toward package mode, but the proof is still bounded by
  startup latency rather than by a passing smoke.
- Next nudge: keep the patch focused on the smallest bounded proof for
  `labBacked: false`, `production-auth-session`, and packaged journal scope;
  if the smoke stays slow, name the exact boot/API blocker instead of rerunning
  the same full test.

## 2026-05-26 12:34 CEST - Durable-Journal Fence Hold

- Going well: the public progress surfaces still stay conservative at `0/4`
  while the release-path fence evidence remains visible in the checked
  verifier path.
- Not going well: the progress lane now has unpushed production-package route
  and journal boundary changes in its worktree, so the feedback lane should
  not pretend the public page is final.
- Progress change: no gate moved; the useful next step is still lane-owned
  code/test work in reliable, plus a clean progress publish once the branch is
  ready to push.
- Next nudge: keep the public page conservative at `0/4`, classify the
  release-path fence evidence narrowly, and do not broaden the production
  claim until the auth/session boundary is proven.

| Lane | Nudge |
| --- | --- |
| Recovery | Only patch if a recovery-owned durable-journal API gap is still blocking the release path. |
| Reliable executor | Move from fence evidence to production-backed auth/session lifecycle or preserved-remote retry. |
| Audit and critic | Classify the latest release-path fence evidence narrowly; do not move the gate without production-backed semantics. |
| Progress publisher | Keep the page fresh, concise, and conservative; preserve `0/4`, then push only when the branch is clean. |
| Invariants | Stay on the unsupported-boundary proof and avoid adjacent churn. |
| Fast paths | Hold unless a code patch changes the runtime receipt or cursor path. |

## 2026-05-26 12:24 CEST - Freshness Alignment

- Going well: the public progress page and log now name `fc2de1bd` as the
  current reliable head, and the preserved-remote retry proof is visible
  without changing the release gate posture.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle evidence, and fenced durable journal ownership still
  blocks any production push claim.
- Progress change: the feedback lane only refreshed the public wording and
  audit anchor to match the current reliable head; no gate moved.
- Next nudge: keep the public page current, concise, and conservative at
  `0/4` until a real gate-moving proof lands from reliable or recovery.

| Lane | Nudge |
| --- | --- |
| Recovery | Land fenced durable journal ownership or name the exact missing adapter. |
| Reliable executor | Move from retry evidence to production-backed auth/session lifecycle or durable storage proof. |
| Audit and critic | Classify `fc2de1bd` specifically; do not move the gate without production-backed semantics. |
| Progress publisher | Keep the page fresh, concise, and conservative; preserve `0/4`. |
| Invariants | Stay on the unsupported-boundary proof and avoid adjacent churn. |
| Fast paths | Hold unless a code patch changes the runtime receipt or cursor path. |

## 2026-05-26 12:22 CEST - Reliable Head Correction

- Going well: the current reliable head is now `9d0279a3`, and the fenced
  stale-claim proof is still the most concrete release-path evidence on the
  durable-journal side.
- Not going well: the checked release path still lacks production-backed
  auth/session lifecycle evidence, and the reliable worktree also has off-lane
  public-progress commits that should stay out of the product evidence trail.
- Progress change: no gate moved; the right next step remains lane-owned
  code/tests in reliable, with progress keeping the public page current and
  conservative.
- Next nudge: keep the public page fresh at `0/4`, and keep reliable focused
  on the next gate boundary instead of surfacing more progress-only commits.

| Lane | Nudge |
| --- | --- |
| Recovery | Only patch if a recovery-owned durable-journal API gap is still blocking the release path. |
| Reliable executor | Stop progress-only churn and move to production-backed auth/session lifecycle or preserved-remote retry. |
| Audit and critic | Classify `9d0279a3` specifically; do not move the gate without production-backed semantics. |
| Progress publisher | Keep the page fresh, concise, and conservative; preserve `0/4`. |
| Invariants | Stay on the unsupported-boundary proof and avoid adjacent churn. |
| Fast paths | Hold unless a code patch changes the runtime receipt or cursor path. |

## 2026-05-26 12:18 CEST - Freshness Alignment

- Going well: the public progress page and log now name `9d0279a3` as the
  current release-path durable-journal fencing head, and the visible status
  now carries a `12:18:56` freshness stamp.
- Not going well: the remaining release proof still needs production-backed
  auth/session lifecycle evidence on the checked release path, plus durable
  journal ownership with lease and fencing, before any production push claim
  is valid.
- Progress change: the feedback lane only refreshed the public wording and
  audit anchor to match the current visible page; no gate moved.
- Next nudge: keep the public page concise, current, and conservative until a
  real gate-moving proof lands from reliable or recovery.

| Lane | Nudge |
| --- | --- |
| Invariants | Keep the unsupported-boundary proof focused on same-plan graph safety. |
| Recovery | Land fenced durable journal ownership or name the exact missing adapter. |
| Reliable executor | Move from fencing proof to live auth/session lifecycle or durable storage proof. |
| Fast paths | Hold until a code patch changes the runtime receipt or cursor path. |
| Audit and critic | Classify only evidence that changes a gate or blocker. |
| Progress publisher | Keep the public page current, concise, and conservative at `0/4`. |

## 2026-05-26 12:11 CEST - Freshness Alignment

- Going well: the public progress page and log now name `9d0279a3` as the
  current release-path durable-journal fencing head, and the visible status
  still keeps gates at `0/4`.
- Not going well: the remaining release proof still needs production-backed
  auth/session lifecycle evidence on the checked release path, plus durable
  journal ownership with lease and fencing, before any production push claim
  is valid.
- Progress change: the feedback lane only refreshed the public wording and
  audit anchor to match the latest reliable head; no gate moved.
- Next nudge: keep the public page concise, current, and conservative until a
  real gate-moving proof lands from reliable or recovery.

| Lane | Nudge |
| --- | --- |
| Invariants | Keep the unsupported-boundary proof focused on same-plan graph safety. |
| Recovery | Land fenced durable journal ownership or name the exact missing adapter. |
| Reliable executor | Move from fencing proof to live auth/session lifecycle or durable storage proof. |
| Fast paths | Hold until a code patch changes the runtime receipt or cursor path. |
| Audit and critic | Classify only evidence that changes a gate or blocker. |
| Progress publisher | Keep the public page current, concise, and conservative at `0/4`. |

## 2026-05-26 11:44 CEST - Freshness Alignment

- Going well: the public progress page and log now name `91419223` as the
  current support-only release-diagnostic head, and the visible status still
  keeps gates at `0/4`.
- Not going well: the remaining release proof still needs production-backed
  auth/session lifecycle evidence on the checked release path, plus durable
  journal ownership with lease and fencing, before any production push claim
  is valid.
- Progress change: the feedback lane only refreshed the public wording and
  audit anchor; no gate moved.
- Next nudge: keep the public page concise, current, and conservative until a
  real gate-moving proof lands from reliable or recovery.

| Lane | Nudge |
| --- | --- |
| Invariants | Keep the unsupported-boundary proof focused on same-plan graph safety. |
| Recovery | Land fenced durable journal ownership or name the exact missing adapter. |
| Reliable executor | Keep driving the live auth/session lifecycle proof into the release boundary. |
| Fast paths | Hold until a code patch changes the runtime receipt or cursor path. |
| Audit and critic | Classify only evidence that changes a gate or blocker. |
| Progress publisher | Keep the public page current, concise, and conservative at `0/4`. |

## 2026-05-26 11:33 CEST - Freshness Alignment

- Going well: the public progress page and log now name `5abb12dc` as the
  current reliable-executor head, and the visible status still keeps gates at
  `0/4`.
- Not going well: production auth/session lifecycle and durable journal
  ownership still block any production push claim.
- Progress change: the feedback lane only corrected stale public wording; no
  gate moved.
- Next nudge: keep the public page concise, current, and conservative until a
  real gate-moving proof lands from reliable or recovery.

| Lane | Nudge |
| --- | --- |
| Invariants | Keep the unsupported-boundary proof focused on same-plan graph safety. |
| Recovery | Land fenced durable journal ownership or name the exact missing adapter. |
| Reliable executor | Move from fail-closed session hardening to live auth/session lifecycle proof. |
| Fast paths | Hold until a code patch changes the runtime receipt or cursor path. |
| Audit and critic | Classify only evidence that changes a gate or blocker. |
| Progress publisher | Keep the public page current, concise, and conservative at `0/4`. |

<details>
<summary>Earlier feedback entries</summary>

## 2026-05-24 23:24 CEST - Scoped Credential And Graph Safety Refresh

- Going well: `82` Node tests pass. Packaged push now rejects unprovisioned
  alternate credentials and unscoped administrator Application Passwords, then
  applies seven graph-safe mutations.
- Also merged: stale WordPress graph references block instead of guessing,
  stale recovery claims fence old workers before mutation, and guarded
  benchmark tests fail closed on unsupported production speed claims.
- Not going well: the route is still lab-backed. Production auth/session
  storage, durable journal ownership, leases, full graph identity mapping, and
  general plugin drivers remain unproven.
- Progress change: no-data-loss, recovery, fast-path, and reliable-executor
  lanes all moved up inside lab/model evidence; production readiness stayed
  blocked.
- Next nudge: replace lab auth/session/journal internals with production
  storage, then prove graph identity mapping without excluding blocked edges
  from route smokes.

| Lane | Nudge |
| --- | --- |
| Invariants | Prove real post/postmeta/attachment/taxonomy identity mapping. |
| Recovery | Move stale-claim fencing from model to production journal storage. |
| Reliable executor | Replace scoped lab credentials with production push credentials. |
| Fast paths | Run the guarded benchmark against a real large Playground/Docker site. |
| Audit and critic | Re-audit after production-backed auth and journal rows land. |
| Progress publisher | Keep Pages dated, concise, and explicit about blocked production gates. |

## 2026-05-24 23:04 CEST - Auth Bootstrap And Redaction Refresh

- Going well: `77` Node tests pass. The packaged plugin now disables lab auth
  bootstrap, requires explicit credentials, rejects an unprovisioned alternate
  credential with `401`, and still passes signed cleanup plus eight-mutation
  apply.
- Also merged: push plans redact raw dependency payloads and keep unsafe
  topology mutations suppressed.
- Not going well: auth, sessions, journal storage, leases, graph identity, and
  plugin drivers are still lab/model proof, not production proof.
- Progress change: reliable executor and invariants nudged up; production
  readiness stayed blocked.
- Next nudge: replace lab-backed auth/session/journal internals with production
  lifecycle and durable storage while preserving replay/conflict refusal.

| Lane | Nudge |
| --- | --- |
| Invariants | Add real graph fixtures before widening automatic apply. |
| Recovery | Prove kill-at-boundary journal durability on production storage. |
| Reliable executor | Prove production credential lifecycle and journal rows. |
| Fast paths | Measure chunking without weakening receipts or preconditions. |
| Audit and critic | Re-audit the next production-backed mutation slice, not just route shape. |
| Progress publisher | Keep Pages concise and dated after each proof change. |

## 2026-05-24 22:45 CEST - Hardening Merge Refresh

- Going well: `76` Node tests pass. The production-shaped and packaged-plugin
  smokes pass; packaged-plugin evidence includes signed-store cleanup
  `deletedExpiredTotal: 2`, `sessionsDeleted: 1`, `noncesDeleted: 1`,
  `applied: 8`, and `finalMatchesLocal: true`.
- Also merged: fast-path proof obligations, no-overwrite topology suppression,
  recovery journaling hardening, protocol transport binding, objective audit,
  and critic production gate refresh.
- Not going well: the endpoint internals remain lab-backed. Production
  credential lifecycle, durable storage, leases/fencing, WordPress graph
  identity, and arbitrary plugin drivers remain unproven.
- Progress change: several lab/model lanes moved up; production push remains
  blocked by missing production internals.
- Next nudge: replace lab-backed auth/session/journal internals with production
  lifecycle and durable storage behavior while keeping replay/conflict refusal
  intact.

| Lane | Nudge |
| --- | --- |
| Invariants | Add real graph fixtures before widening automatic apply. |
| Recovery | Prove kill-at-boundary journal durability on production storage. |
| Reliable executor | Replace lab auth/session storage with production lifecycle. |
| Fast paths | Measure chunking without weakening receipts or preconditions. |
| Audit and critic | Re-audit the next production-backed mutation slice, not just route shape. |
| Progress publisher | Keep Pages concise and dated after each proof change. |

## 2026-05-24 22:32 CEST - Package Nudge

- Going well: `70` Node tests pass, the production-shaped route smoke passes,
  and a normal plugin package now activates `/wp-json/reprint/v1/push/*` with
  the public lab namespace disabled.
- Not going well: the route still uses lab auth and lab journal internals.
  Production credential lifecycle, nonce/session cleanup, durable storage,
  leases, and arbitrary plugin drivers are still unproven.
- Progress change: reliable executor moved from route-shape proof to packaged
  endpoint proof; production readiness remains blocked.
- Next nudge: replace the lab-backed internals one layer at a time: production
  auth cleanup, durable journal rows, replay/conflict refusal, then recovery
  inspect under the packaged plugin.

| Lane | Nudge |
| --- | --- |
| Invariants | Prove real post/postmeta/attachment/taxonomy graph identity. |
| Recovery | Kill DB/file/journal boundaries against durable storage. |
| Reliable executor | Swap lab auth/journal internals for production ones. |
| Fast paths | Benchmark large chunks with receipts and resume cursors. |
| Audit and critic | Re-audit this packaged endpoint before any readiness jump. |
| Progress publisher | Keep the page dated, one-screen, and caveat-linked. |

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
