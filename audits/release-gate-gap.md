# Release Gate Gap

The current checkout still cannot support a production release claim because the strongest proof is split across optional commands, lab-backed routes, and refusal-only benchmarks.

## What exists

- `npm test` runs the Node test suite only.
- `npm run test:playground` chains a local Playground plan/apply/push protocol smoke.
- Stronger smoke commands exist for auth, production-shaped routes, plugin packaging, journal behavior, storage guards, stale claims, and recovery.
- The authenticated push route still identifies itself as `labBacked: true`.
- There is no checked-in `.github` workflow file in this checkout.

## What is missing

- One required `verify:release`-style command that fails closed when any proof bucket is still lab-backed, fixture-only, benchmark-only, or missing live-source evidence.
- A checked-in CI or equivalent default entrypoint that invokes that command.
- A single enforced decision point that combines auth/session, durable journal, leases/fencing, graph identity, plugin-data-driver, real topology, crash-boundary, and measured speed proof.

## Why this blocks release

The repo can still produce green runs by choosing a non-release command.
That means current success evidence is not mandatory release evidence.

Until the release gate exists and is wired into a checked-in default automation path, the objective remains blocked.
