# Operator Safe Recovery

Variant: RPP-0904 operator docs variant 1
Status: support-only documentation

This runbook turns the recovery state contract into operator steps. It is
based on [Apply Journal Recovery States](./apply-journal.md) and
[Acceptable Post-Failure States](./acceptable-states.md). It does not change
release gates, does not approve production repair, and does not make lab
recovery evidence production-backed.

## Safety Rule

An operator may proceed only when the failed apply is classifiable as exactly
one recovery state:

- `old-remote`: no remote mutation committed. Retry is allowed only after the
  journal proves the same plan envelope and the operator revalidates current
  preconditions.
- `fully-updated-remote`: every planned mutation is already present. The only
  safe action is to finalize or replay the completed receipt without applying
  new mutation work.
- `blocked-recovery`: the remote is partial, drifted, incomplete, or
  ambiguous. Automated retry and manual write repair must stop until a recovery
  owner completes an explicit review.

Any state outside that set is unsafe. A production partial remote mutation with
missing, incomplete, unowned, or uninspectable recovery artifacts remains a
release blocker.

## Required Evidence Before Action

Do not infer recovery state from a status code, a browser view, or an operator
memory of the failed run. Record these facts before choosing an action:

- failed push identifier or receipt identifier;
- checked recovery path used for inspection and, if applicable, mutation;
- journal ownership result and active writer or claim evidence;
- restart-readable journal records with monotonic ordering;
- planned mutation count and per-target old/new/blocked-unknown counts;
- before and after hashes for each planned target;
- current observed hash for each planned target;
- terminal journal evidence, or the specific missing terminal evidence that
  caused the block;
- idempotency replay result for the same request body, when retry is being
  considered; and
- redaction result proving the artifact is hash/count/metadata only.

If any item is missing, mark the case `blocked-recovery`. Missing evidence is
not evidence that the remote is old or fully updated.

## Safe Recovery Flow

1. Freeze further apply attempts for the same push envelope.
2. Capture the recovery artifact set from the checked recovery path.
3. Verify the artifact is inspectable, hash-only, and owned by the expected
   recovery boundary.
4. Classify the state using only journaled before hashes, journaled after
   hashes, live observed hashes, and terminal journal records.
5. Compare the classification with the three acceptable states.
6. Choose only the action allowed for that state.
7. Record the action, the state, the artifact references, and the operator who
   accepted the evidence.

## Allowed Actions By State

| State | Required proof | Allowed action | Forbidden action |
| --- | --- | --- | --- |
| `old-remote` | Every target still matches the journaled before hash, no mutation evidence crossed the commit boundary, and the same plan envelope is still valid. | Re-run the apply only through the normal validated apply path with the same idempotency semantics. | Editing remote content by hand, retrying after current hashes drift, or reusing a journal for a different plan. |
| `fully-updated-remote` | Every target matches the journaled after hash, the completed journal or missing-commit finalization proof accounts for all planned targets, and replay performs zero fresh mutations. | Finalize the receipt or replay the completed result without writing target data. | Reapplying inserts, replaying stale local values, or treating partial target matches as complete. |
| `blocked-recovery` | Any target is partial, drifted, unknown, uninspectable, unowned, or missing required terminal evidence. | Keep apply blocked, preserve artifacts, open a recovery review, and collect additional hash-only evidence. | Automated retry, manual patching, cleanup that deletes artifacts, or release movement. |

## Hidden-Assumption Checks

Before any retry or finalization, answer each check explicitly in the audit
record:

- Is the inspected recovery path the same path that the recovery action will
  use?
- Is the journal restart-readable after the failure or restart event?
- Is every planned target accounted for in the target counts?
- Are all current target hashes explained by either the planned before hash or
  planned after hash?
- Is there a terminal commit, replay, or block record that matches the
  classification?
- Has the same idempotency request either replayed safely or failed closed?
- Are credentials, raw row payloads, option values, post content, file content,
  private paths, cookies, and live service configuration absent from the
  artifact?
- Does the action preserve final release `NO-GO` unless separate production
  release gates pass?

If any answer is no or unknown, the operator must use `blocked-recovery`.

## Release Posture

These instructions are an operator support document. They do not make the
current lab journal, Playground DB journal, file journal, or local topology
evidence production durable. They do not authorize production repair, storage
rollback, release approval, or release-gate movement. Final release remains
`NO-GO` until the separate release gates pass with production-backed evidence.
