# Release Blockers

This note is intentionally narrow: it records the current blockers that keep the WordPress push objective from being a production release claim. A green `npm test` run is still only refusal-, fixture-, or lab-backed evidence unless the same run also reaches the live source boundary and fails closed when any release proof is missing.

## Current blockers

1. No command in this checkout currently owns the live-source verdict, so there is no single release gate that can fail closed on auth/session, durable journal, leases/fencing, graph identity, plugin-driver, topology, crash-boundary, recovery, and benchmark gaps in one invocation.
2. The strongest authenticated push route still self-identifies as `labBacked: true`, so the best visible push evidence is still lab-scoped and does not prove the production boundary.
3. The benchmark tests are refusal-only. They prove the suite can reject unsupported throughput claims, but they do not measure the live push path, establish a release threshold, or fail closed on missing live-path speed proof.
4. The current recovery and journal tests are fixture-backed. They prove local model behavior, not durable production storage on the live source boundary.
5. There is no checked-in CI workflow in this checkout, so there is no visible enforced entrypoint that could make the release gate mandatory.
6. `package.json` still exposes `test`, `plan`, `apply`, and optional playground helpers only. That surface can support release work, but it does not itself define an enforced release verdict.
7. The current tests are valid regression and refusal evidence, but they stop short of the live-source boundary, so they cannot prove no data loss, reliability under crash/replay, or measured speed on the production path.
8. There is still no checked-in `verify`, `verify:release`, or `release` command that would force the live-source preflight to run and fail closed when preserved-remote evidence is absent, but that script gap is secondary to the missing live-boundary proof itself.

## Required proof before release

- Live-source mutation after a pull-base snapshot, with a recheck immediately before apply.
- Durable production journal evidence on the real storage path.
- Lease and fencing behavior that blocks stale or concurrent writers on the live boundary.
- Graph identity behavior for the WordPress data shapes that can be rewritten or preserved.
- Measured end-to-end speed evidence with an explicit threshold, or a required command that fails when the speed claim is still `not-claimed`.
- One enforced release gate that fails closed if any of the above is missing or only lab-backed, and that is the same command CI actually invokes.

## Practical next step

Add or locate a single checked command that reaches the retained source, revalidates at apply time, and prints a machine-checkable failure when any of the required live-boundary claims are still only lab-backed. Until that exists, every passing helper remains support evidence rather than release evidence.

## Audit rule

If a claim is still supported only by fixture tests, refusal tests, route-shape smokes, or `labBacked: true` evidence, it does not count as release proof. That includes a green `npm test` run unless the checked-in release gate itself reaches the live source boundary.
