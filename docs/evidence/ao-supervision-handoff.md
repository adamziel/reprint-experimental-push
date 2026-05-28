# AO supervision handoff - 2026-05-28

The stale worker panes were cleaned up and a new Agent Orchestrator team was
started from `agent-orchestrator.yaml` with tmux runtime and worktree isolation.

Current live team:

| Session | Role | Primary scope |
| --- | --- | --- |
| `rpp-1` | Developer | Release gates, `RPP-0001` through `RPP-0025` |
| `rpp-2` | Developer | Journal/recovery, `RPP-0601` through `RPP-0635` |
| `rpp-3` | Developer | Graph identity, `RPP-0301` through `RPP-0335` |
| `rpp-4` | Developer | Plugin-driver boundary, `RPP-0401` through `RPP-0435` |
| `rpp-5` | Developer | Executor auth/session/leases, `RPP-0501` through `RPP-0535` |
| `rpp-6` | Developer | Chunking benchmark, `RPP-0701` through `RPP-0735` |
| `rpp-7` | Independent audit | Release evidence audit, `RPP-0901` through `RPP-0915` |
| `rpp-8` | Critic | Lane critique, `RPP-0916` through `RPP-0935` |
| `rpp-9` | Progress reporter | Evidence reporting, `RPP-0936` through `RPP-0955` |

The AO orchestrator session is `rpp-orchestrator`. It has been handed the
policy to keep at least five developer workers active, plus a critic and a
progress reporter, and to replenish completed or dead developer sessions with
new checklist work.

The orchestrator should avoid long sleep-based monitoring loops. When the team
is busy, it should inspect tmux panes and process state, review lane outputs,
critique evidence, report progress, or prepare the next bounded worker task.

Operational note: in this sandbox build, `ao acknowledge`, `ao report`,
`ao status`, `ao session`, and `ao send` can hang. Supervision should use tmux
and process inspection plus bounded `ao spawn` for new lanes. Hung AO lifecycle
helper child processes may be killed, but active coding sessions should stay
alive.

No remote tunnels are allowed. Use loopback services and the sandbox-provided
8080 ingress only.
