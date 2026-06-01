# Release Security Review Checklist

Date: 2026-06-01
Variant: RPP-0907 security review checklist variant 1
Scope: support-only security review discipline for release gates

This checklist defines the security review discipline for Reprint Push release
gate movement. A support-only review can improve documentation, name missing
proof, and validate local assertions, but it cannot move any release gate.
Release gate status moves only after production-backed evidence is present,
fresh, redacted, and tied to the live source-site path under review.

Evidence artifact: [RPP-0907 support-only review checklist](../evidence/rpp-0907-security-review-checklist.md)

## Gate Movement Rule

- Production-backed evidence is required before changing a release gate from
  blocked, held, support-only, or NO-GO toward release eligibility.
- Support-only review evidence is not production-backed evidence.
- Local tests, documentation review, checklist completion, synthetic fixtures,
  and command readbacks are supporting evidence only unless they are attached to
  production-backed operator evidence.
- Missing production-backed evidence keeps the final release at **NO-GO**.
- This checklist does not authorize release-gate status changes.

## Review Checklist

| ID | Security control | Production-backed evidence required before gate movement | RPP-0907 support-only review result | Release effect |
| --- | --- | --- | --- | --- |
| SR-01 | Live source identity | Fresh operator evidence that binds the reviewed source site to the final release scope. | Not provided by this support-only review. | Blocked |
| SR-02 | Scoped authentication and permission | Production-backed proof that the source path uses scoped push permissions and rejects insufficient permission. | Not provided by this support-only review. | Blocked |
| SR-03 | Replay and request integrity | Production-backed proof that replay, duplicate, and changed-body attempts fail closed for the release path. | Not provided by this support-only review. | Blocked |
| SR-04 | Current remote read before planning | Production-backed proof that dry-run reads the current live source state before planning. | Not provided by this support-only review. | Blocked |
| SR-05 | Conflict and stale-state refusal | Production-backed proof that stale, conflicting, or drifted source state stops before mutation. | Not provided by this support-only review. | Blocked |
| SR-06 | Immediate preconditions before writes | Production-backed proof that every mutation revalidates live preconditions immediately before writing. | Not provided by this support-only review. | Blocked |
| SR-07 | Recovery and journal safety | Production-backed proof that journals classify only old remote, fully updated remote, or blocked recovery after failure. | Not provided by this support-only review. | Blocked |
| SR-08 | Redacted evidence handling | Production-backed proof that artifacts exclude credentials, private payloads, cookies, and raw site values. | This support-only review adds redacted checklist evidence only. | Blocked |

## Support-Only Discipline

RPP-0907 satisfies only the support-review obligation: the review checklist is
explicit, the evidence artifact is redaction-oriented, and the focused test
proves the release gate remains blocked without production-backed evidence.
The final release recommendation remains **NO-GO**.
