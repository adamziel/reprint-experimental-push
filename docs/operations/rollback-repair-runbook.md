# Rollback and Repair Runbook

Variant: RPP-0911 rollback/repair runbook variant 1
Status: support-only operations documentation

This runbook turns the existing recovery-state contract into an audit-ready
rollback and repair procedure. It depends on
[Apply Journal Recovery States](../recovery/apply-journal.md),
[Acceptable Post-Failure States](../recovery/acceptable-states.md), and the
support evidence in
[RPP-0911 rollback repair runbook evidence](../evidence/rpp-0911-rollback-repair-runbook.md).

This document is not production-backed proof. It does not authorize release
movement, production rollback, manual remote repair, or release-gate status
changes. Final release remains `NO-GO` unless separate production-backed
release evidence proves otherwise.

## Decision Rule

Classify the failed apply before choosing any action. The only supported
states are:

- `old-remote`: no remote mutation committed. Retry is allowed only through the
  normal validated apply path after current preconditions are rechecked.
- `fully-updated-remote`: every planned mutation is already present. Finalize
  or replay the completed result only when replay performs zero fresh mutation
  work.
- `blocked-recovery`: the remote is partial, drifted, ambiguous, unowned, or
  missing required evidence. Stop retry, preserve artifacts, and open a repair
  review.

Any state outside this set is treated as `blocked-recovery`. Missing evidence
is not evidence that rollback, repair, or retry is safe.

## Rollback Policy

Automatic rollback is not authorized by the current artifact set. The recovery
journals are hash-only support artifacts; they prove before hashes, after
hashes, observed hashes, target counts, boundaries, and journal ownership, but
they do not carry raw before values that could reconstruct production content.

Use rollback language only for containment and audit classification:

1. Freeze further apply attempts for the same push envelope.
2. Preserve the journal, receipt, command output, and hash-only observed state.
3. Confirm whether every target is still at the journaled before hash.
4. If every target is old, route the case to validated retry, not rollback.
5. If any target is new, drifted, or unknown, keep the case
   `blocked-recovery`.

Do not hand-edit production rows, files, options, plugin data, or content as a
rollback substitute. A production rollback procedure requires separate
production-backed evidence that is outside this slice.

## Repair Policy

Repair means roll-forward reconciliation from an inspectable recovery envelope,
not ad hoc editing. A repair plan may be prepared only when the journal proves
the same plan envelope, every planned target is accounted for, and current
observed hashes are explained by the journaled before or after hashes.

Allowed repair actions:

| State | Repair action | Required evidence |
| --- | --- | --- |
| `old-remote` | No repair. Revalidate and retry through the normal apply path. | Same plan envelope, before hashes still current, no crossed commit boundary. |
| `fully-updated-remote` | No data repair. Finalize or replay with zero fresh mutations. | After hashes still current, completed or replayable terminal evidence. |
| `blocked-recovery` | Stop and preserve artifacts. Escalate to a recovery owner. | Journal plus observed hashes proving partial, drifted, unknown, incomplete, or unowned state. |

Roll-forward repair of old targets is support-only until production-backed
durability, ownership, and redaction evidence exists. Drift outside the
before/after envelope always blocks automated repair.

## Required Evidence

Record the following before an operator recommends retry, finalization, or
repair review:

- failed push identifier or receipt identifier;
- exact inspected recovery path and artifact names;
- journal ownership and writer or claim evidence;
- restart-readable journal records with monotonic order;
- command output used to identify relevant commits;
- planned target count and old/new/unknown counts;
- before hash, after hash, and current observed hash for each target;
- terminal journal evidence or the missing terminal evidence that caused the
  block;
- same request replay result when retry or finalization is considered;
- redaction scan result proving support evidence is hash, count, and metadata
  only; and
- final `NO-GO` release posture when production-backed proof is absent.

If any required item is missing, choose `blocked-recovery`.

## Audit Command and Commit Links

The audit trail for this runbook uses these exact local commands:

```bash
git show -s --format='%h%x09%H%x09%s' HEAD
git log --oneline --decorate -12
git log --oneline --all --grep='rollback\|repair\|recovery' -20
git log --oneline --all --grep='RPP-0904\|RPP-0905\|RPP-0906' -12
```

The command output anchors this support document to the following commits:

| Commit | Subject | Audit use |
| --- | --- | --- |
| `c4faf5245` | Merge published progress page state | Current branch head observed before the RPP-0911 update. |
| `404506c5e` | docs: publish progress page | Observed origin main reference during the audit. |
| `fe3af9d8e` | Add RPP-0906 critic audit disposition | Prior support-only critic audit posture. |
| `54f6b6b3c` | Add RPP-0904 operator safe recovery docs | Existing recovery operator contract used as the runbook base. |
| `12f684cd3` | Add RPP-0690 old-remote recovery release proof | Historical old-remote recovery classification anchor. |
| `bced8d1ae` | Add RPP-0691 new-remote recovery release proof | Historical new-remote recovery classification anchor. |
| `3b0d2c873` | Add RPP-0692 blocked recovery release proof | Historical blocked recovery classification anchor. |
| `d3c23e7e6` | Add RPP-0693 unknown-drift recovery release proof | Historical drift classification anchor. |
| `e627a9717` | Add RPP-0700 manual recovery audit export release proof | Historical manual recovery audit-export anchor. |

## Validation Commands

Focused validation for this slice:

```bash
node --check test/rpp-0911-rollback-repair-runbook.test.js
node --test --test-name-pattern RPP-0911 test/rpp-0911-rollback-repair-runbook.test.js
node scripts/release/artifact-redaction-scan.mjs docs/operations/rollback-repair-runbook.md docs/evidence/rpp-0911-rollback-repair-runbook.md
git diff --check
```

These commands validate documentation structure, command and commit anchors,
support-only evidence, redaction posture, and whitespace cleanliness.

## Release Posture

This runbook is support-only evidence. It adds no production endpoint, no live
source proof, no production durability proof, no production mutation proof, and
no release-gate status movement. Keep final release `NO-GO` unless a separate
production-backed release audit proves every required gate.
