# Support Escalation Guide

Date: 2026-06-01
Variant: RPP-0917 support escalation guide variant 1
Scope: support-only escalation handling for release gates
Status: support-only, release blocking

This guide defines how support escalations are handled while Reprint Push is in
release-gate review. A support escalation can preserve evidence, classify risk,
and name the production proof needed next, but it cannot move any release gate.
Release gate status moves only after production-backed evidence is present,
fresh, redacted, and tied to the exact production path under review.

Evidence artifact: [RPP-0917 support escalation guide evidence](../evidence/rpp-0917-support-escalation-guide.md)

## Gate Movement Rule

- Support escalation evidence is support-only evidence.
- Support escalation alone never changes release gate status, final release
  status, progress records, completion checklists, or status files.
- Production-backed evidence is required before changing a release gate from
  support-only, held, blocked, or `NO-GO` toward release eligibility.
- Missing production-backed evidence keeps the final release at **NO-GO**.
- Escalation owners must not start remote tunnel services. Use only the
  sandbox-provided 8080 ingress and local-only processes inside the sandbox.

## Escalation Intake

| ID | Trigger | Support action | Production-backed evidence required before gate movement | Release effect |
| --- | --- | --- | --- | --- |
| SE-01 | Live source identity is unclear. | Record the missing identity proof and stop release escalation at support-only. | Fresh operator proof binding preflight, dry-run, apply, journal, and recovery to the same live source. | Blocked |
| SE-02 | Authentication or permission boundary is disputed. | Preserve the failing command class and route area without storing private values. | Production-backed proof that the checked user and route permissions match the release path. | Blocked |
| SE-03 | Stale remote, conflict, or drift is suspected. | Keep the incident in triage and require a before/after envelope review. | Production-backed proof that the current live remote was read and stale or conflicting state refused before mutation. | Blocked |
| SE-04 | Apply, journal, or recovery outcome is uncertain. | Classify the state as unresolved and do not authorize repair or rollback from support notes. | Production-backed journal or recovery evidence showing old remote, fully updated remote, or blocked recovery. | Blocked |
| SE-05 | Evidence provenance or redaction is incomplete. | Reject the artifact for release-gate credit and request redacted replacement evidence. | Production-backed redacted artifact with source provenance, timestamp, and release scope. | Blocked |
| SE-06 | Operator pressure asks for release movement without proof. | Record the request as support-only and keep release status unchanged. | Production-backed release gate evaluation that satisfies the required final-release checks. | Blocked |

## Escalation Workflow

1. Record the escalation ID, trigger, affected gate area, and support owner.
2. Confirm that no production mutation, rollback, repair, or gate status change
   is authorized by the escalation itself.
3. Preserve only redacted support evidence. Do not store raw site values,
   private payloads, cookies, credentials, or session material.
4. Name the exact production-backed evidence required to unblock gate movement.
5. Keep the final release recommendation at **NO-GO** until that production
   evidence is validated by the release gate evaluator.

## Handoff Requirements

Support may hand off an escalation to release operators only when the handoff
names the missing production proof, the affected gate, the current support-only
status, and the command or artifact that should be rerun with production-backed
inputs. The handoff is not approval. Release operators must run the appropriate
production-backed verification and keep the gate unchanged if the proof is
absent, stale, unredacted, or not tied to the exact release scope.

## Final Posture

RPP-0917 adds a support-only escalation guide and evidence record. It does not
add production-backed evidence, does not attempt mutation, does not change any
release gate status, and does not change final release posture.

Final release remains **NO-GO**.
