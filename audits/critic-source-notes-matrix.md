# Critic Source-Notes Matrix

This matrix is the compact comparison record for the current critic baseline.
It is not retry authority. It only records what the upstream notes prove as
historical context and what still needs branch-local proof before production-
grade push wording is allowed.

The comparison is intentionally conservative: a note can explain design
lineage, but it cannot prove the live executor boundary, preserved-remote
auditability, or retry authority unless this branch reran the same live
boundary here and preserved the rejected remote for audit.

The upstream anchors recorded in `docs/source-notes.md` are `27c5f25`
for Reprint, `d9334a0` for ZS-Sync, and `55f9879` for ForkPress. Those
anchors are provenance only, not retry authority.

## Reprint

- Proves: staged transport, resumability vocabulary, and chunked delivery
  framing.
- Does not prove here: live push safety, preserved-remote retention after
  rejection, stale-authority rejection before the first write, create-time
  identity remap safety, plugin-owned surface coverage, or retry authority on
  this branch.
- Missing repo proof: a rerunnable live boundary on a real local,
  Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected
  remote, shows apply-time revalidation, and classifies every touched surface
  old, new, or blocked.

## ZS-Sync

- Proves: bounded discovery, cursoring, and batched resource selection.
- Does not prove here: source-mutation safety, plugin-owned allowlist
  coverage, stale-authority rejection, durable journal semantics, graph
  identity, or late-discovered surface handling on this branch.
- Missing repo proof: the same live boundary rerun here with preserved-
  remote evidence, dry-run receipt, journal/recovery inspection, and plugin-
  driver coverage on the live write boundary.

## ForkPress

- Proves: merge-audit vocabulary, review framing, and crash-consistency
  intent.
- Does not prove here: retry authority, preserved-remote auditability after
  rejection, auth/session lifecycle on the write boundary, remapped create
  target handling, or plugin-owned surface retries on this branch.
- Missing repo proof: one real-site release command on this branch that proves
  the rejected remote stayed inspectable, the first write was blocked until
  stale authority was rejected, and later-discovered plugin-owned surfaces
  got their own preserve / reject / retry cycle.

## Branch-local rule

Any comparison to Reprint, ZS-Sync, or ForkPress stays historical context
unless this branch reruns the same live boundary and proves:

- the exact live `REPRINT_PUSH_SOURCE_URL`;
- the preserved remote that stayed inspectable after rejection;
- the exact rejection point before the first write;
- dry-run receipt and apply-time revalidation;
- journal/recovery inspection;
- graph identity and plugin-driver coverage; and
- old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface.

If a comparison note says "passed", "resolved", or "production-ready" but
does not name the exact live boundary and preserved remote on this branch,
that wording is false reliability and must be treated as compatibility
evidence only.
