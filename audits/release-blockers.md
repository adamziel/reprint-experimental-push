# Release Blockers

This note is intentionally narrow: it records the current blockers that keep the WordPress push objective from being a production release claim.

## Current blockers

1. There is no single required release command that composes auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real remote/local topology, crash-boundary, recovery, and benchmark checks.
2. The strongest authenticated push route still self-identifies as `labBacked: true`, so the best visible push evidence is still lab-scoped.
3. The benchmark tests are refusal-only. They prove the suite can reject unsupported throughput claims, but they do not measure the live push path or establish a release threshold.
4. The current recovery and journal tests are fixture-backed. They prove local model behavior, not durable production storage on the live source boundary.
5. There is no checked-in CI workflow in this checkout, so there is no visible enforced entrypoint that could make the release gate mandatory.

## Required proof before release

- Live-source mutation after a pull-base snapshot, with a recheck immediately before apply.
- Durable production journal evidence on the real storage path.
- Lease and fencing behavior that blocks stale or concurrent writers on the live boundary.
- Graph identity behavior for the WordPress data shapes that can be rewritten or preserved.
- Measured end-to-end speed evidence with an explicit threshold.
- One enforced release gate that fails closed if any of the above is missing or only lab-backed.

## Audit rule

If a claim is still supported only by fixture tests, refusal tests, route-shape smokes, or `labBacked: true` evidence, it does not count as release proof.
