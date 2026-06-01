# Failure triage runbook

Date: 2026-06-01
Owner: release operations
Scope: Reprint Push failure triage
Status: support-only, release blocking

This runbook defines the minimum triage path for failed Reprint Push release,
dry-run, apply, journal, and recovery checks. It does not close production
risks, does not authorize manual repair, and does not move release gates. Final
release remains **NO-GO** until production closure proof closes every open
triage risk in a final go/no-go record.

## Triage invariants

- Preserve the failed command output, generated artifacts, journal references,
  current gate report, and exact command line before retrying anything.
- Treat unknown state, missing artifacts, unredacted evidence, and incomplete
  live readback as release blockers.
- Do not run mutation, recovery finalization, or manual source edits during
  triage unless an approved production recovery procedure explicitly authorizes
  the action for the same plan envelope.
- Do not use remote tunnel services. Use only local sandbox ingress and
  local-only proxies when local inspection is required.
- Do not record raw site payloads, auth material, cookies, or private operator
  notes in evidence artifacts.
- Keep release status **NO-GO** when production closure proof is absent.

## First response

1. Freeze the failed lane. Stop retries and preserve the working tree, journal
   files, generated evidence, and terminal output.
2. Identify the failed phase: release gate, preflight, dry-run, apply,
   journal, recovery inspect, recovery mutate, packaging, benchmark, or
   artifact validation.
3. Record whether any mutation was attempted. If this cannot be proven, classify
   the incident as unknown state and keep release **NO-GO**.
4. Confirm that evidence is redacted. If redaction cannot be proven, stop
   triage and replace the artifact with hash-count metadata only.
5. Classify the failure bucket from the matrix below. If multiple buckets
   apply, carry all of them into the final go/no-go record.
6. Update the final go/no-go record by naming each remaining risk or attaching
   production closure proof that closes it. Support-only documents never close a
   production risk.

## Failure classification matrix

| Bucket | Failure signal | Required triage action | Release posture |
| --- | --- | --- | --- |
| Source boundary | Live source, local edited site, or changed remote boundary is missing or ambiguous. | Preserve command output and require production live-boundary readback before closure. | NO-GO |
| Auth boundary | Scoped push auth proof is absent, stale, or bound to the wrong source. | Preserve auth proof metadata only and require production source-bound auth readback. | NO-GO |
| Planning | Dry-run cannot prove base, local, and current remote comparison for every target. | Preserve the plan summary, counts, and hashes; do not apply. | NO-GO |
| Conflict | Concurrent source change, remote-only resource, or unknown owner is detected. | Preserve conflict evidence and require operator review with no mutation. | NO-GO |
| Apply guard | Just-in-time precondition, compare-and-swap, or filesystem guard is missing. | Stop before mutation and require guarded production apply evidence. | NO-GO |
| Journal | Journal ownership, ordering, terminal state, or restart readability is missing. | Preserve the journal and classify recovery as blocked. | NO-GO |
| Recovery | Remote state is not old-remote or fully-updated-remote with proof. | Keep recovery blocked and prohibit manual patching. | NO-GO |
| Artifact integrity | Evidence is missing, unredacted, stale, or not tied to the same plan envelope. | Replace with redacted hash-count metadata and rerun focused validation. | NO-GO |
| Performance | Timeout, memory, chunk cursor, or benchmark failure prevents reliable completion. | Preserve measurements and require large-site proof with safety guards enabled. | NO-GO |
| Release process | Status files, progress records, or gates would move from support-only evidence. | Stop integration and keep status unchanged. | NO-GO |

## Required closure package

A triage risk can be closed only by production closure proof that includes:

- the failed phase and exact non-mutating diagnostic commands;
- current live source readback tied to the same plan envelope;
- redacted artifact hashes, counts, and timestamps;
- mutation-attempt status and, when relevant, guarded retry or blocked recovery
  outcome;
- release impact, operator decision, and linked focused regression evidence;
- confirmation that no release gate, progress record, or completion checklist
  changed as part of the closure package.

If any required closure field is missing, the risk remains open and release
remains **NO-GO**.

## Remaining triage risk register

| Risk ID | Disposition | Release blocker | Named risk | Production closure proof required |
| --- | --- | --- | --- | --- |
| RPP-0910-RISK-01 | Open | Yes | Production closure proof is absent for the failed release posture. | Production final go/no-go evidence that ties every closed risk to current production closure proof. |
| RPP-0910-RISK-02 | Open | Yes | Failed phase may be misclassified without preserved command, artifact, and journal context. | Redacted production incident packet naming the failed phase and preserved artifacts. |
| RPP-0910-RISK-03 | Open | Yes | Live source and auth boundaries may be unproven or stale. | Production live-boundary and scoped auth readback for the same source and plan envelope. |
| RPP-0910-RISK-04 | Open | Yes | Triage may rely on status codes instead of current hashes and target counts. | Production evidence comparing current hashes, target counts, and terminal state. |
| RPP-0910-RISK-05 | Open | Yes | Concurrent remote drift may not be revalidated before retry or closure. | Production stale-state refusal or guarded retry proof captured immediately before action. |
| RPP-0910-RISK-06 | Open | Yes | Manual repair or retry could mutate source state outside the approved plan. | Production recovery proof showing authorized action, mutation-attempt status, and guarded outcome. |
| RPP-0910-RISK-07 | Open | Yes | Journal or recovery state may be ambiguous after interruption. | Restart-readable production journal with old-remote, fully-updated-remote, or blocked-recovery classification. |
| RPP-0910-RISK-08 | Open | Yes | Evidence artifacts may leak raw site values or auth material. | Passing redaction scan over the exact production closure artifacts. |
| RPP-0910-RISK-09 | Open | Yes | Ownership and handoff decisions may be unclear during incident response. | Production incident record naming operator owner, reviewer, decision time, and release impact. |
| RPP-0910-RISK-10 | Open | Yes | Support-only documentation could be mistaken for release-gate closure evidence. | Release gate audit proving no gate, progress, status, or checklist movement from support-only evidence. |
| RPP-0910-RISK-11 | Open | Yes | Root cause may not be mapped to regression coverage before reattempt. | Focused production-backed regression or documented quarantine accepted by release operations. |
| RPP-0910-RISK-12 | Open | Yes | Closure may be accepted without independent review of production artifacts. | Independent production closure review confirming all open risks are closed or still named. |

## Final go/no-go rule

Release can move to GO only when the final record lists every risk above with a
disposition of `closed`, links production closure proof for each closed risk,
and records zero remaining release blockers. When production closure proof is
absent, every risk remains open and final release remains **NO-GO**.
