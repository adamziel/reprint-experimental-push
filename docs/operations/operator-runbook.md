# Reprint Push Operator Runbook

Variant: RPP-0909 operator runbook variant 1
Status: support-only production operation guidance
Final release: `NO-GO`

This runbook is for safe Reprint Push operation and recovery discipline. It
does not grant production approval, does not move release gates, and does not
authorize ad hoc repair. A production apply is allowed only through the normal
validated plan/apply/replay path after a separate release gate has approved the
exact production run.

The recovery state contract remains the one documented in
[Apply Journal Recovery States](../recovery/apply-journal.md),
[Acceptable Post-Failure States](../recovery/acceptable-states.md), and
[Operator Safe Recovery](../recovery/operator-safe-recovery.md).

## Operating Posture

- Treat production as write-protected until every prerequisite below is
  recorded for the same run envelope.
- Use one named operator, one named recovery owner, and one active single-writer
  lease for the target remote.
- Use only the validated apply path, validated replay path, and documented
  recovery inspector. Manual production edits are not a recovery mechanism.
- Capture hash/count/metadata-only evidence. Do not store credentials, raw row
  values, option values, post text, file bytes, cookies, private paths, or live
  service configuration in evidence artifacts.
- Preserve all recovery artifacts before any retry, finalization, cleanup, or
  escalation.
- Keep final release `NO-GO` unless a separate production-backed release gate
  process passes. This document alone is not release evidence.

## Prerequisites

Record every prerequisite before starting production apply work. If any item is
missing or unknown, stop before mutation.

- separate release gate approval for the exact run envelope;
- source and target site identities verified from approved operator inventory;
- immutable plan identifier, receipt identifier, plan hash, and mutation count;
- dry-run result with no unresolved conflicts or stale preconditions;
- current precondition hashes for every planned target;
- single-writer lease owner, lease timestamp, and lease expiry policy;
- durable restart-readable journal path or table for the same run envelope;
- idempotency key hash bound to the same request body;
- backup or snapshot identifier recorded outside the evidence artifact;
- operator, reviewer, and recovery owner names recorded in the incident or run
  log;
- approved authentication material is not copied into evidence;
- local-only network posture confirmed, with no remote tunnel and no additional
  exposed ingress beyond the approved sandbox or production access path; and
- rollback, traffic freeze, and customer-impact decision owner identified
  before mutation begins.

## Evidence Capture

Capture enough evidence for another operator to reconstruct the decision
without trusting memory, UI impressions, or unstated context.

Preflight evidence:

- run identifier, operator, reviewer, recovery owner, and UTC timestamp;
- release gate decision, and whether it is production-backed for this exact
  run;
- source identity hash, target identity hash, plan hash, receipt identifier,
  mutation count, and target count;
- dry-run status, conflict count, precondition status, and current precondition
  hash set;
- lease owner hash, lease claim timestamp, journal location hash, and journal
  schema/version identifier;
- idempotency key hash and request body hash; and
- backup or snapshot reference hash plus the owner responsible for restoring it.

During apply:

- journal-opened evidence before the first target mutation;
- monotonic journal sequence numbers and restart-readable boundary records;
- storage guard, compare-and-write, or compare-and-rename result for each
  mutation boundary;
- per-target before hash, planned after hash, and observed hash;
- dependency validation result before commit finalization;
- terminal completed, replayed, rejected, or blocked journal evidence; and
- redaction result for every artifact that will be retained or shared.

Failure or restart inspection:

- failed push identifier or receipt identifier;
- checked recovery path used for inspection and any retry or finalization;
- journal ownership result and active writer or claim evidence;
- restart-readable journal records with monotonic ordering;
- planned mutation count and per-target old/new/blocked-unknown counts;
- before and after hashes for each planned target;
- current observed hash for each planned target;
- terminal journal evidence, or the exact missing terminal evidence that caused
  the stop;
- idempotency replay result for the same request body; and
- redaction result proving the artifact is hash/count/metadata-only.

## Stop Conditions

Stop immediately and preserve artifacts when any condition below is true:

- separate release gate approval is absent, expired, or for a different run;
- source or target identity is ambiguous;
- single-writer lease is missing, stale, unowned, or contested;
- durable journal is missing, uninspectable, unowned, non-monotonic, or not
  restart-readable;
- dry-run conflicts remain unresolved;
- precondition hashes drift before or during apply;
- target count, mutation count, or plan hash does not match the run envelope;
- current observed hashes cannot be explained by the journaled before or after
  hashes;
- terminal evidence is missing after a mutation boundary;
- same key replay would require fresh mutations for an already completed run;
- the run would need manual production edits, direct database changes, manual
  file patching, or cleanup that deletes recovery artifacts;
- evidence contains raw or sensitive material;
- a remote tunnel or unapproved network ingress is needed to continue;
- the case classifies as `blocked-recovery`; or
- an operator cannot answer a hidden-assumption check below with explicit
  evidence.

When stopped, do not retry automatically, do not patch production by hand, and
do not perform release-gate movement. Preserve the journal, receipt, hash-only
observations, and stop reason for recovery review.

## Recovery Decision

Do not infer production safety from a green status code, a browser view, a
successful HTTP response, or an operator memory of the failed run. Missing
evidence is a stop condition, not proof that production is old or complete.

Classify a failed or interrupted run as exactly one of these states:

- `old-remote`: no remote mutation committed. Retry is allowed only through the
  normal validated apply path after revalidating current preconditions for the
  same plan envelope.
- `fully-updated-remote`: every planned mutation is already present. Finalize
  or replay only when replay performs zero fresh mutations.
- `blocked-recovery`: the remote is partial, drifted, unknown, unowned, or
  missing required evidence. Keep apply blocked, preserve artifacts, and open
  recovery review.

Any state outside that set is unsafe. The checked recovery path must be the path
used for inspection and any retry or finalization. A different path, different
plan, different request body, different lease owner, or different journal owner
requires a new run envelope and blocks recovery for the failed one.

## Hidden-Assumption Checks

Before retry, finalization, cleanup, or escalation, record explicit answers to
these checks:

- Is the release gate approval production-backed and bound to this exact run?
- Are the inspected source and target identities the intended production pair?
- Is the checked recovery path the same path used by the recovery action?
- Is the journal restart-readable after the failure or process restart?
- Is every planned target accounted for in the target counts?
- Are all current target hashes explained by either the planned before hash or
  planned after hash?
- Does terminal evidence match the selected recovery state?
- Does same key replay return the same result without fresh mutation work, or
  fail closed?
- Are all artifacts redacted to hash/count/metadata-only evidence?
- Does the action avoid manual production edits, direct database changes,
  release-gate movement, and artifact deletion?

An unknown answer stops the run. The operator must record `blocked-recovery`
when the evidence cannot answer the check directly.

## Release Posture

This runbook is support-only operator guidance. It does not prove production
durability, production rollback, production repair, live source access,
customer-safe rollout, or release readiness. Final release remains `NO-GO`.
