# Versioned Release Protocol

Date: 2026-06-01
Status: support-only, release blocking
Scope: versioned release protocol documentation
Final release: **NO-GO**

## Purpose

This document records the support-only versioned release protocol boundary for
Reprint Push. It describes how protocol versions, capability sets, fallback
rules, and release evidence must be documented before release movement can be
considered.

This document is not production-backed release evidence. It does not move a
release gate, approve production mutation, start a dashboard, publish progress,
or close any production risk. Final release remains **NO-GO** until separate
production evidence proves each open risk.

## Support Boundary

Support-only documentation does not close production risks. A risk can move to
closed only when current production-backed evidence names the exact protocol
version, capability set, route boundary, command output, redaction result, and
release verifier result that proves the closure.

The protocol documentation boundary is:

| Area | Support-only rule |
| --- | --- |
| Release posture | Final release remains **NO-GO**. |
| Gate movement | No release gate, status file, checklist, progress log, or progress page movement is authorized. |
| Production evidence | No production risk is closed without production-backed proof. |
| Mutation authority | Protocol documentation never grants preflight, dry-run, apply, journal, or recovery authority. |
| Network posture | Use only local-only sandbox ingress; do not use remote tunnel services. |
| Artifact posture | Evidence must remain redacted and must not include raw site values or authentication material. |

## Version Contract

The documented release protocol family is
`reprint-push-release-protocol`. Version offers are required before any
release-facing push action can be treated as eligible for mutation.

| Field | Required documented value |
| --- | --- |
| Schema version | `1` |
| Minimum supported protocol | `1.0.0` |
| Current protocol | `1.1.0` |
| Supported versions | `1.0.0`, `1.1.0` |
| Required capability groups | `auth`, `journal`, `lease`, `apply`, `dry-run`, `recovery`, `topology` |
| Unknown version policy | Fail closed. |
| Downgrade policy | Fail closed. |
| Capability policy | Exact capability set required for the negotiated version. |
| Fallback policy | `no-fallback-after-incompatible-offer` |
| Mutation without negotiation | Not allowed. |

The documented version inventory is support evidence only:

| Version | Documentation status | Capability expectation |
| --- | --- | --- |
| `1.0.0` | Supported baseline | Requires exact auth, journal, lease, dry-run, apply, recovery, and planning capability evidence. |
| `1.1.0` | Current documented version | Adds storage-boundary revalidation, durable commit boundary, monotonic lease sequencing, and local-only ingress evidence. |

## Required Closure Evidence

Production closure for any versioned protocol risk requires a redacted
production evidence packet that includes:

1. Protocol family, offered version, selected version, and supported-version
   inventory.
2. Exact capability list and capability digest for the selected version.
3. Route boundary where the offer was checked before preflight, dry-run,
   apply, journal, or recovery action.
4. Current live source and target identity hashes for the same run envelope.
5. Apply or refusal result proving mutation was either guarded by the
   negotiated version or blocked before mutation.
6. Release verifier output showing final release status and release movement
   decision.
7. Artifact redaction result for the exact production closure packet.
8. Independent production review naming which risks remain open and which, if
   any, are closed by the production packet.

## Stop Conditions

Stop and keep release **NO-GO** when any of these conditions is true:

- No current production-backed version negotiation evidence exists.
- The live route did not prove the version offer before mutation authority.
- The offered protocol version is unknown, downgraded, missing, or ambiguous.
- The offered capability set is missing required entries or includes
  undocumented entries.
- A higher incompatible offer is ignored in favor of a lower compatible offer.
- The release verifier is not tied to the same versioned protocol evidence.
- The protocol document differs from executable compatibility behavior.
- Evidence artifacts contain raw site values, authentication material, private
  paths, or unredacted operator notes.
- Support-only documentation is being treated as release-gate closure.
- Independent production review has not accepted the closure packet.

## Final Go/No-Go Risk Record

Decision: **NO-GO**

Reason: this slice provides support-only documentation. It names every
remaining versioned protocol documentation risk and closes none because
production-backed closure proof is absent.

| Risk ID | Disposition | Release blocker | Named remaining risk |
| --- | --- | --- | --- |
| RPP-0915-RISK-01 | Open | Yes | Production closure proof is absent for versioned release protocol documentation. |
| RPP-0915-RISK-02 | Open | Yes | Release verifier is not production-bound to the versioned protocol document and evidence packet. |
| RPP-0915-RISK-03 | Open | Yes | Live preflight, dry-run, apply, journal, and recovery routes may not enforce protocol negotiation before authority is granted. |
| RPP-0915-RISK-04 | Open | Yes | Capability digest evidence may not be bound to the dry-run receipt, apply guard, and final release record. |
| RPP-0915-RISK-05 | Open | Yes | Unknown-version and downgrade rejection are not proven by current production route evidence. |
| RPP-0915-RISK-06 | Open | Yes | Incompatible-offer fallback refusal is not proven against production release behavior. |
| RPP-0915-RISK-07 | Open | Yes | Mixed-version client and remote compatibility is not proven for the final release topology. |
| RPP-0915-RISK-08 | Open | Yes | Supported-version inventory, deprecation policy, and capability ownership have not been independently approved with production evidence. |
| RPP-0915-RISK-09 | Open | Yes | Protocol documentation may drift from executable compatibility behavior without a production-backed alignment check. |
| RPP-0915-RISK-10 | Open | Yes | Support-only protocol documentation could be mistaken for release-gate closure evidence. |
| RPP-0915-RISK-11 | Open | Yes | Redacted production artifact package for versioned protocol closure is absent. |
| RPP-0915-RISK-12 | Open | Yes | Independent production review has not confirmed each versioned protocol risk as closed or still open. |

Closed risks: none.

Integration recommendation: **NO-GO** for release movement. Integrate only as
support evidence for the versioned release protocol documentation slice.
