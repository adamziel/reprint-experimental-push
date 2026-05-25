# No Data Loss Durable Journal Recovery Inspect Boundary

This lane treats durable recovery as release-blocked unless every failure path lands in one of these states:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery` with inspectable journal and remote artifacts

The executable boundary is the apply/replay handoff in [`test/push-planner.test.js`](/home/claude/reprint-experimental-push-lanes/cycle-20260525-keep-busy-loop-2/no-data-loss-recovery/test/push-planner.test.js):

- failure before mutation stays `old-remote`
- failure after staging stays `old-remote`
- failure after dependency validation stays `old-remote`
- replaying a completed plan stays `fully-updated-remote`
- stale or partial replay stays `blocked-recovery`

The recovery inspect boundary is only acceptable when:

- the journal can be reopened after process exit
- the replay result preserves the journal artifact
- `blocked-recovery` also preserves the remote artifact for inspection
- retrying from a completed journal does not duplicate inserts or resurrect stale local data

If a partial remote mutation exists without a recovery artifact, the state is not safe to release.
