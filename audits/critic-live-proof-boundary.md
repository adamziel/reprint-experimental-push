# Live Proof Boundary

Current status for this critic branch: the supervised reliable-executor lane
has improved retained-source evidence, but this worktree still lacks a
rerunnable live release command against a real local, Playground, or Docker
`REPRINT_PUSH_SOURCE_URL`.

What the current retained-source evidence proves:

- the remote lane can now report executor/session/journal details such as
  `authSessionType`, minted session shape, `applyCommitted`, and
  `durableJournal.rows: 17`;
- `verify:release` exists in the supervised lane and is useful as lab
  evidence; and
- the supervised result is a stronger baseline than route shape alone.

What it does not prove on this branch:

- production WordPress auth/session lifecycle on the write boundary;
- preserved-remote auditability after rejection;
- apply-time revalidation on a real live rerun;
- durable journal semantics outside the retained-source Playground path;
- graph identity across create-time remaps and late-discovered surfaces; or
- plugin-driver coverage for hidden plugin-owned data traps outside the
  allowlist.

The next acceptable proof is exact:

- one rerunnable live command on a real local, Playground, or Docker
  `REPRINT_PUSH_SOURCE_URL`;
- the executor identity and auth/session boundary before the first write;
- the preserved remote that remains inspectable after rejection;
- the exact rejection point before the first write;
- dry-run receipt, apply-time revalidation, and journal/recovery inspection on
  the same boundary; and
- old/new/blocked classification for every touched row, file,
  relationship-bearing record, and plugin-owned surface before retry starts.

Failure modes that must still be treated as blockers:

- a remote drifts after dry-run but before apply and the retry path reuses
  stale authority instead of rebuilding from fresh live hashes;
- a create-time remap lands on a different row, file, or relationship-bearing
  record than the plan approved;
- a later plugin-owned surface appears outside the allowlist and is folded
  into the earlier approval; or
- manual resolution is treated as success without preserved-remote audit
  evidence and retryable scope reconstruction.
