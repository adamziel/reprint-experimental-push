# Critic Source-Notes Matrix

This matrix is the compact comparison record for the current critic baseline.
It is not retry authority. It only records what the upstream notes prove as
historical context and what still needs branch-local proof before production-
grade push wording is allowed, including a named real-site release command
that can be rerun unchanged on the same live boundary.

The comparison is intentionally conservative: a note can explain design
lineage, but it cannot prove the live executor boundary, preserved-remote
auditability, or retry authority unless this branch reran the same live
boundary here and preserved the rejected remote for audit.

The upstream anchors recorded in `docs/source-notes.md` are `27c5f25`
for Reprint, `d9334a0` for ZS-Sync, and `55f9879` for ForkPress. Those
anchors are provenance only, not retry authority.

The practical rule is simple: each note can explain why the design looks the
way it does, but none of them prove the live WordPress auth/session boundary,
the preserved remote, the named real-site release command, or the fresh retry
scope on this branch. Production-grade wording still needs a branch-local
rerun that names the exact command, the exact live `REPRINT_PUSH_SOURCE_URL`,
the exact boundary that was rejected before the first write, and the exact
set of plugin-owned surfaces that were either enumerated or blocked before
retry.

## Reprint

- Proves: staged transport, resumability vocabulary, and chunked delivery
  framing.
- Does not prove here: live push safety, preserved-remote retention after
  rejection, stale-authority rejection before the first write, create-time
  identity remap safety, plugin-owned surface coverage, retry authority, or
  any branch-local live rerun on this worktree.
- Missing repo proof: a rerunnable live boundary on a real local,
  Playground, or Docker `REPRINT_PUSH_SOURCE_URL` that preserves the rejected
  remote, shows apply-time revalidation, and classifies every touched surface
  old, new, or blocked, including any late-discovered plugin-owned surface or
  remapped create target.

## ZS-Sync

- Proves: bounded discovery, cursoring, and batched resource selection.
- Does not prove here: source-mutation safety, plugin-owned allowlist
  coverage, stale-authority rejection, durable journal semantics, graph
  identity, late-discovered surface handling, or any live retry authority on
  this branch.
- Missing repo proof: the same live boundary rerun here with preserved-
  remote evidence, dry-run receipt, journal/recovery inspection, plugin-
  driver coverage, and explicit classification of hidden plugin-owned data
  traps outside the allowlist on the live write boundary.

## ForkPress

- Proves: merge-audit vocabulary, review framing, and crash-consistency
  intent.
- Does not prove here: retry authority, preserved-remote auditability after
  rejection, auth/session lifecycle on the write boundary, remapped create
  target handling, plugin-owned surface retries, or any branch-local live
  rerun on this worktree.
- Missing repo proof: one real-site release command on this branch that proves
  the rejected remote stayed inspectable, the first write was blocked until
  stale authority was rejected, and later-discovered plugin-owned surfaces or
  mixed file/DB/plugin side effects got their own preserve / reject / retry
  cycle.

## Branch-local rule

Any comparison to Reprint, ZS-Sync, or ForkPress stays historical context
unless this branch reruns the same live boundary and proves:

- the exact live `REPRINT_PUSH_SOURCE_URL`;
- a named real-site release command that can be rerun unchanged on this
  branch;
- the preserved remote that stayed inspectable after rejection;
- the exact rejection point before the first write;
- dry-run receipt and apply-time revalidation;
- journal/recovery inspection;
- graph identity and plugin-driver coverage; and
- old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface.

If a comparison note says "passed", "resolved", or "production-ready" but
does not name the exact live boundary, preserved remote, and rerunnable
real-site release command on this branch, that wording is false reliability
and must be treated as compatibility evidence only.
