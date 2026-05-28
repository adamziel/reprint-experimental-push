# AO critic live roster 36 evidence

Audited lane after replay: `origin/lane/evidence-integration-20260527` at `9140a7645` with checklist truth 128 checked / 872 open and final release **NO-GO**.

## Severity-ordered evidence

1. **High - release-gate restack required.** `RPP-0068` and `RPP-0069` now conflict directly with `9140a7645` in `docs/evidence/ao-release-gates.md`; active `RPP-0070` must restack too.
2. **High - generated-harness pileup.** `RPP-0151`, `RPP-0150`, and `RPP-0345` are clean individually but conflict pairwise in generated harness docs/cases/tests; active `RPP-0152` and `RPP-0153` share the surface.
3. **High - plugin-driver pileup.** `RPP-0463`, `RPP-0464`, `RPP-0466`, and local `RPP-0467` are clean individually but conflict pairwise in `docs/evidence/ao-plugin-driver.md` and overlap planner tests; `RPP-0468` is also active.
4. **High - stale active panes.** `rpp-24`, `rpp-25`, `rpp-33`, `rpp-34`, `rpp-32`, and `rpp-36` show behind state after the lane moved and need replay before commit/push.
5. **Medium - stale merge-invariant branch.** `RPP-0238` remains stale behind `RPP-0237`; `RPP-0240` is active on planner/generated tests.
6. **Medium - handoff caveat.** Progress and queue panes are useful context but branch-local/stale; use the lane hash and checklist lint as the authority.
7. **Medium - roster is active.** The developer floor is met, but most work is on shared conflict-prone files.

## Follow-up owners

- `rpp-25`: restack `RPP-0068`/`RPP-0069`/`RPP-0070` after the `RPP-0067` lane move.
- `rpp-24`, `rpp-30`, `rpp-33`: serialize generated-harness branches and rerun full generated harness tests after each lane move.
- `rpp-32`, `rpp-34`: serialize plugin-driver branches and preserve local-only caveats.
- `rpp-29`: restack stale `RPP-0238` if it remains in the queue; validate `RPP-0240` after shared-surface lane moves.
- `rpp-35`, `rpp-36`: keep queue/progress outputs pinned to public lane `9140a7645` until a newer lane commit exists.
