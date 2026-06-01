# Post-Release Monitoring Plan

Variant: RPP-0919 post-release monitoring plan variant 1
Status: support-only operations documentation
Final release: `NO-GO`

This plan defines how operators would monitor a Reprint Push release after an
approved production apply. It is support documentation only. It does not start
dashboards, does not create production monitoring proof, does not authorize
rollback or manual repair, and does not move release gates. Final release stays
`NO-GO` until a separate production-backed monitoring packet proves the exact
production run was observed safely.

Use this plan with [Reprint Push Operator Runbook](operator-runbook.md),
[Failure triage runbook](failure-triage-runbook.md), and
[Rollback and Repair Runbook](rollback-repair-runbook.md). Recovery state
classification remains limited to `old-remote`, `fully-updated-remote`, and
`blocked-recovery`.

## Monitoring Boundary

Post-release monitoring starts only after the same run envelope has approved
production release gate evidence, a completed apply receipt, and restart-readable
journal evidence. Without those inputs, there is no post-release monitoring
state to observe; the operator must preserve artifacts and keep release
`NO-GO`.

The monitoring boundary covers:

- production health for the exact source and target identity pair;
- apply receipt, plan hash, target count, mutation count, and journal terminal
  state for the same run envelope;
- current observed target hashes compared with journaled before and after
  hashes;
- user-visible smoke checks that record only pass/fail, route name, timestamp,
  count, and hash metadata;
- error budget and incident signals summarized as counts and timestamps; and
- recovery readiness, including the named operator, reviewer, recovery owner,
  backup owner, and stop authority.

The boundary excludes raw database rows, post content, option values, file
bytes, production credentials, application password values, cookies, private
paths, live service configuration, backup contents, and customer data.

## Explicit Assumptions

Operators must write these assumptions into the production monitoring packet
before relying on the plan. An unknown answer stops monitoring and keeps final
release `NO-GO`.

- The release gate approval is production-backed and bound to this exact run
  envelope.
- The observed source identity and target identity are the intended production
  pair.
- The apply receipt, plan hash, target count, mutation count, and journal owner
  all refer to the same run envelope.
- The checked recovery path is the same path that would be used for retry,
  replay, finalization, or recovery review.
- The monitoring window begins after commit finalization and after terminal
  journal evidence is readable after restart.
- The current observed hash for every planned target is explained by the
  journaled before hash or planned after hash.
- The monitoring signals are production-backed, current, and not copied from
  local or support-only fixtures.
- The evidence packet is hash, count, timestamp, route-name, and metadata only.
- The operator has not used a remote tunnel, unapproved ingress, manual
  production edit, direct database patch, or release-gate status change.
- A missing metric, missing receipt, missing terminal journal entry, or stale
  observation is a stop condition, not a safe default.

## Required Monitoring Inputs

Record every input below before a release can be monitored or recommended for
GO. Missing input means the monitoring packet is incomplete and the release
remains `NO-GO`.

| Input | Required evidence | Stop if missing |
| --- | --- | --- |
| Release gate decision | Production-backed gate record for this run envelope. | Yes |
| Run envelope | Apply receipt identifier, plan hash, target count, mutation count, and idempotency key hash. | Yes |
| Identity binding | Source identity hash and target identity hash from approved inventory. | Yes |
| Journal terminal state | Restart-readable journal owner, sequence range, and completed or blocked terminal evidence. | Yes |
| Target hash readback | Before hash, planned after hash, and current observed hash for every planned target. | Yes |
| Health signals | Error counts, success counts, route names, latency buckets, and UTC window boundaries. | Yes |
| Customer-impact signal | Incident count, escalation status, and stop authority decision. | Yes |
| Recovery owners | Named operator, reviewer, recovery owner, backup owner, and incident owner. | Yes |
| Redaction result | Passing artifact redaction scan for the exact monitoring packet. | Yes |

## Monitoring Windows

Use fixed UTC windows and do not infer safety from a single successful request.

| Window | Purpose | Minimum action |
| --- | --- | --- |
| T+0 to T+15 minutes | Confirm commit finalization and immediate error signal stability. | Verify terminal journal state, target hashes, and route count summaries. |
| T+15 to T+60 minutes | Catch early drift, elevated errors, and stale cache behavior. | Compare current hashes and review error, latency, and incident counts. |
| T+60 to T+24 hours | Confirm no delayed recovery or data integrity signal appears. | Preserve monitoring packet and re-run non-mutating hash/count readback. |

If any window lacks production-backed proof, mark the window incomplete and keep
the release `NO-GO`.

## Safe Recovery Paths

Monitoring can recommend only one of these paths:

| Recovery state | Monitoring evidence | Operator action |
| --- | --- | --- |
| `old-remote` | No production mutation committed and every planned target remains at the journaled before hash. | Stop monitoring, preserve artifacts, and re-enter the normal validated apply path only after all current preconditions are rechecked. |
| `fully-updated-remote` | Every planned target is at the planned after hash, terminal evidence is restart-readable, and same-request replay would perform zero fresh mutations. | Preserve the monitoring packet and allow finalization or replay only through the checked recovery path. |
| `blocked-recovery` | Any target is partial, drifted, unknown, unowned, missing evidence, or outside the before/after hash envelope. | Stop retries, preserve artifacts, keep release `NO-GO`, and escalate to recovery review. |

Any status outside this table is `blocked-recovery`. Do not use a green status
code, healthy dashboard color, browser view, or operator memory as a substitute
for current target hashes, terminal journal evidence, and same-envelope
readback.

## Stop Conditions

Stop monitoring, preserve artifacts, and keep final release `NO-GO` when any
condition below is true:

- production-backed monitoring proof is absent;
- release gate approval is missing, expired, support-only, or bound to a
  different run;
- source or target identity is ambiguous;
- apply receipt, plan hash, target count, mutation count, idempotency key hash,
  or journal owner does not match the run envelope;
- terminal journal evidence is missing, stale, unowned, non-monotonic, or not
  restart-readable;
- current observed hashes are missing or not explained by before or after
  hashes;
- monitoring signals are copied from local fixtures, support-only artifacts, or
  an earlier run;
- health, latency, incident, or customer-impact counts are missing for a
  required window;
- same-request replay would create fresh mutations after completion;
- the recovery path used for inspection differs from the path used for retry,
  replay, finalization, or review;
- the operator would need manual production edits, direct database changes, or
  cleanup that deletes recovery artifacts;
- evidence contains raw or sensitive material;
- a remote tunnel or unapproved ingress is required to continue;
- a release gate, status file, progress record, or completion checklist would
  move based on this support-only plan; or
- any explicit assumption above cannot be answered from evidence.

## Monitoring Packet

The production monitoring packet must be generated outside this support slice
and must contain only redacted hash, count, timestamp, route-name, and metadata
evidence. It must include:

- run envelope identifiers and production-backed release gate decision;
- source and target identity hashes;
- apply receipt identifier, plan hash, target count, mutation count, and
  idempotency key hash;
- restart-readable journal terminal evidence and owner;
- target hash readback for every planned target;
- monitoring window start and end timestamps;
- route-level success counts, error counts, and latency bucket summaries;
- incident count and escalation owner decision;
- selected recovery state and reason;
- redaction scan result over the exact packet; and
- final release posture.

This RPP-0919 slice does not include that production packet. Until it exists and
passes review, final release remains `NO-GO`.

## Validation Commands

Focused validation for this slice:

```bash
node --check test/rpp-0919-post-release-monitoring-plan.test.js
node --test --test-name-pattern RPP-0919 test/rpp-0919-post-release-monitoring-plan.test.js
node scripts/release/artifact-redaction-scan.mjs docs/operations/post-release-monitoring-plan.md docs/evidence/rpp-0919-post-release-monitoring-plan.md
git diff --check
```

## Release Posture

This monitoring plan is support-only documentation. It names the assumptions,
inputs, stop conditions, and safe recovery paths that a future production
monitoring packet must prove. It does not provide production-backed monitoring
proof, does not authorize release movement, and does not close any final release
risk. Keep final release `NO-GO`.
