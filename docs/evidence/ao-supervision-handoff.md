# AO supervision handoff - 2026-05-28

The stale worker panes were cleaned up and a new Agent Orchestrator team was
started from `agent-orchestrator.yaml` with tmux runtime and worktree isolation.
After the first lifecycle service exhausted the default Node heap, AO was
restarted in `main:ao-orchestrator` with:

```sh
NODE_OPTIONS=--max-old-space-size=4096 ao start --no-dashboard --reap-orphans --no-restore
```

The stale `rpp-1` through `rpp-9` tmux sessions were retired after confirming
their branches were pushed and their worktrees were clean except AO scratch.
Their session metadata was archived under
`~/.agent-orchestrator/projects/reprint-push/sessions/stale/`.

Current live team:

| Session | Role | Primary scope |
| --- | --- | --- |
| `rpp-10` | Developer | Local Docker/production-shaped complex site harness |
| `rpp-11` | Developer | Rollback and repair recovery boundaries |
| `rpp-12` | Developer | Release-gate CLI/CI fail-closed checks |
| `rpp-13` | Developer | Evidence and journal redaction |
| `rpp-14` | Developer | Protocol compatibility negotiation |
| `rpp-15` | Critic | Critique fresh developer lanes and integration branches |
| `rpp-16` | Progress reporter | Keep progress report current without inflating readiness |
| `rpp-17` | Developer/integrator | Safe session branch integration |
| `rpp-18` | Developer/integrator | AO-spawned replacement integration lane |
| `rpp-19` | Developer/integrator | AO-spawned replacement integration lane |
| `rpp-20` | Developer | Route proof matrix for production push route boundaries |
| `rpp-21` | Developer | Operator proof status marker for release evidence |

The AO orchestrator session is `rpp-orchestrator`. It has been handed the
policy to keep at least five developer workers active, plus a critic and a
progress reporter, and to replenish completed or dead developer sessions with
new checklist work.

Observed stable handoff state:

- AO lifecycle process is running from the `main:ao-orchestrator` tmux window.
- `ao spawn --prompt ...` works and created `rpp-10` through `rpp-16`.
- After handoff, the AO orchestrator spawned `rpp-17`, `rpp-18`, `rpp-19`,
  `rpp-20`, and `rpp-21` without manual worker creation.
- `rpp-20` and `rpp-21` are interactive tmux Codex sessions with visible stdout
  activity, not detached log-only jobs.
- Active developer floor is above five even when critic/progress roles are not
  counted.
- Old pushed branches remain available on `origin/session/rpp-*`; do not rely
  on the archived tmux panes for evidence recovery.

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
