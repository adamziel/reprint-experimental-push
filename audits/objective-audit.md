# Objective Audit

## Verdict

- Audited commit: `83d0fe8507f2b0cfaf5e376ec2501fe3c2266371` (`Prove checked apply revalidation before mutation`)
- Previous audited reliable head: `3ee9908847b2e2b89bad40abc4d0add4acd96731`
- Latest reliable diff reviewed: `3ee9908847b2e2b89bad40abc4d0add4acd96731..83d0fe8507f2b0cfaf5e376ec2501fe3c2266371`
- Reliable advanced since the supervisor baseline: `yes`
- Current critic head: `3ce65fcec7a0506fae9267205733c53e56cef89e`
- Critic verdict: `0/4`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 08:44:39 CEST (+0200)
- Release-classification heads verified before write-up:
  - `origin/lane/reliable-executor` -> `83d0fe8507f2b0cfaf5e376ec2501fe3c2266371` (`Prove checked apply revalidation before mutation`)
  - `origin/lane/critic` -> `3ce65fcec7a0506fae9267205733c53e56cef89e` (`Classify reliable head 83d0fe85`)

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Checked apply revalidation before first mutation | `83d0fe85` adds `applyRevalidation` evidence to the packaged REST apply result, threads it through `src/authenticated-http-push-client.js`, and asserts it in `scripts/playground/production-shaped-release-verify.mjs`. The checked release command now proves `required: fresh-live-hashes-before-first-mutation`, `phase: before-first-mutation`, matching plan and receipt hashes, and a positive active claim sequence. | The same proof on a production-owned Reprint endpoint rather than a packaged/Playground route and verifier surface. | Support-only |
| Production-shaped checked release evidence | `timeout 300s npm run verify:release` passed in a detached worktree at `83d0fe85`, including `test:playground:production-shaped-live-release-verify`, plugin-driver guard checks, and file-journal restart smoke. | Production-owned endpoint evidence instead of `scripts/playground/*` and packaged-plugin proof. The command still proves a packaged boundary, not the real release boundary. | Support-only |
| Production-owned auth/session lifecycle | The passing release command shows a packaged `production-auth-session` lifecycle on the checked release path, but it is still exercised through Playground-backed packaged routes and verifier wiring. | One checked live run on the real endpoint proving auth/session issuance, readback, expiry or rotation handling, revocation, cleanup, and stale-session refusal on that same production boundary. | Blocked |
| Durable journal ownership with lease fencing and restart-readable replay | The release command proves packaged journal readback, stale-claim retry, lease-fence fields, and file-journal restart behavior. | Real endpoint proof that the durable journal is production-owned, lease-fenced, crash-readable after restart, and consumed on the same live boundary being audited. | Blocked |
| Playground readiness versus production readiness | The new verifier assertions and packaged route changes show that Playground can surface apply-revalidation evidence, but they do not convert Playground readiness into production readiness. | Evidence outside `scripts/playground/*` and packaged-plugin scaffolding that the same behavior exists on the real production endpoint. | Blocked |
| Plugin-driver proof | `verify:release` now includes `test:playground:production-plugin-driver-verifier-guards`, which proves guard behavior around missing or malformed driver contracts. | A checked live plugin-driver ownership proof on the real release boundary, not only guard-only packaged-driver scenarios. | Blocked |
| Head stability | The detached worktree run of `node --test test/authenticated-http-push-client.test.js` at `83d0fe85` failed 16 of 105 tests, with several regressions now returning `APPLY_REVALIDATION_REQUIRED` before prior auth/journal verdicts and others failing replay or retry expectations. | A green direct client/unit surface for the audited head, or an explicit explanation that the release gate intentionally excludes these failing checks. | Blocked |

## Release Blockers

1. `83d0fe85` materially improves checked release proof shape: apply responses now carry `applyRevalidation` evidence, the packaged REST plugin records it before mutation, and the release verifier asserts it directly.
2. That evidence is still packaged and Playground-backed. The passing `verify:release` run consumes `scripts/playground/production-shaped-live-release-verify.mjs`, packaged route wiring, plugin-driver guard smoke, and file-journal restart smoke rather than a production-owned Reprint release boundary.
3. The head is not clean on its direct client surface: `node --test test/authenticated-http-push-client.test.js` failed 16 tests in the detached `83d0fe85` worktree, including failures where the new apply-revalidation gate now outranks earlier auth/session or journal expectations. That makes a conservative gate move unjustified even before the open product blockers are considered.
4. The current critic lane is aligned for this head and independently keeps `83d0fe85` at `0/4`.
5. The required checked live release primitive is still broader than this diff: one run on the real Reprint endpoint must prove auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.

## Critic Alignment

The current critic verdict at `3ce65fcec7a0506fae9267205733c53e56cef89e` remains aligned with this audit. Both lanes treat `83d0fe85` as useful checked apply-revalidation hardening while keeping the overall release-gate verdict at `0/4`.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. plugin-driver ownership on the release boundary
4. preserved rejected-remote evidence
5. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
