Audited `83d0fe8507f2b0cfaf5e376ec2501fe3c2266371` (`Prove checked apply revalidation before mutation`).

Verdict: `0/4`

What changed:
- `src/authenticated-http-push-client.js` now fails closed on missing or drifted `applyRevalidation` evidence before proceeding past apply, and records that boundary as `APPLY_REVALIDATION_REQUIRED`.
- `scripts/playground/push-remote-rest-plugin.php` now emits apply-time revalidation evidence including plan hash, receipt hash, verified resource keys, and active claim sequence before the first mutation.
- `scripts/playground/push-db-journal-lib.php` now preserves `applyRevalidation` in compact and replay evidence.
- `scripts/playground/production-shaped-release-verify.mjs` now asserts that the checked release path proves fresh live hashes before first mutation and binds that proof to an active claim.

Why it does not move the gate:
- The new proof is still packaged and Playground-backed. The passing `timeout 300s npm run verify:release` run is built from `scripts/playground/*`, packaged route wiring, plugin-driver guard smoke, and file-journal restart smoke rather than a production-owned Reprint endpoint.
- The open release blockers remain unchanged: production-backed auth/session lifecycle, durable journal ownership with lease/fencing and restart-readable replay, Playground-to-production readiness, and real plugin-driver ownership proof.
- The direct client surface is not green at this head: `node --test test/authenticated-http-push-client.test.js` failed 16 of 105 tests in a detached `83d0fe85` worktree, including regressions where `APPLY_REVALIDATION_REQUIRED` now outranks prior auth/session or durable-journal expectations.

Critic alignment:
- `3ce65fcec7a0506fae9267205733c53e56cef89e` (`Classify reliable head 83d0fe85`) also keeps the verdict at `0/4`, and this audit agrees.

Commands run:
- `git fetch origin --prune`
- `git show --stat --summary 83d0fe8507f2b0cfaf5e376ec2501fe3c2266371`
- `git diff 3ee9908847b2e2b89bad40abc4d0add4acd96731..83d0fe8507f2b0cfaf5e376ec2501fe3c2266371 -- src/authenticated-http-push-client.js scripts/playground/push-remote-rest-plugin.php scripts/playground/push-db-journal-lib.php scripts/playground/production-shaped-release-verify.mjs`
- `git show 3ce65fcec7a0506fae9267205733c53e56cef89e:audits/critic.md`
- `git worktree add /tmp/reprint-audit-83d0fe85 83d0fe8507f2b0cfaf5e376ec2501fe3c2266371`
- `node --test test/authenticated-http-push-client.test.js` (fails: 16 of 105)
- `npm run test:playground:production-shaped-release-verify`
- `timeout 300s npm run verify:release`

Next blocker:
- One checked live run on the real Reprint endpoint must prove, on the same boundary, production auth/session issuance and readback, durable journal ownership with lease/fencing and restart-readable replay, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
