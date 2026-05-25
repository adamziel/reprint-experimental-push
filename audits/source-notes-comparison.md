# Conservative Source-Notes Comparison

This note is intentionally narrow: it records what the source notes support and
what they do not support for production push wording.

## Reprint

What it proves:

- Reprint already has a pull pipeline with staged phases, resumability, and
  export-side resource helpers.
- The repo here can borrow the idea of staged execution and resumable work.

What it does not prove:

- It does not prove a live source mutation boundary for push.
- It does not prove stale remote drift rejection at apply time.
- It does not prove identity remapping on create, plugin-owned allowlist
  coverage, or partial file/DB/plugin side-effect classification.
- It does not prove production auth, replay cleanup, TLS policy, or audit
  retention for push.

## ZS-Sync

What it proves:

- ZS-Sync shows a scanner/resource model for detecting changes and batching
  them.
- It can inform the planning side of a push design.

What it does not prove:

- It does not prove source-site mutation.
- It does not prove atomicity, crash recovery, or conflict policy for a live
  push write path.
- It does not prove plugin semantic ownership, create-time remap handling, or
  the durable classification of partial side effects.

## ForkPress

What it proves:

- ForkPress documents stronger audit and crash-consistency ideas than a plain
  copy-and-replay design.
- It is a useful source for invariants around merge auditability and recovery
  state.

What it does not prove:

- It does not prove this repo's live write boundary.
- It does not prove that route-shape, package layout, or lab fixtures are
  sufficient for production push support.
- It does not prove the exact current upstream state unless the cited upstream
  revision or worktree was reverified at the same live mutation boundary.

## Rule For Production Claims

A production-grade push claim may cite these notes only as historical or
design context unless the exact upstream revision or worktree state was
reverified and the same live write boundary was exercised in this repo.
Without that revalidation, the notes cannot backfill missing proof for:

- live remote drift rejection,
- stale approval expiry,
- create-time remap or alias handling,
- plugin-owned allowlist coverage,
- partial file/DB/plugin side-effect classification,
- or remote-preserving retry behavior.
