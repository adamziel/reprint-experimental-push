# Critic Verdict

Current reliable head: `e9c9e36980b738f584eadf113ff5599ce885cd39`
(`Fail closed on stale-claim lifecycle drift`).

Verdict: `0/4`

Reason:

- This head tightens the checked auth/session and durable-journal lifecycle
  surfaces so stale-claim drift now fails closed in the client summary and in
  the recovery-journal contract. The new coverage rejects mismatched stale
  claim status/event combinations and proves the checked boundary stays closed
  when the observed claim says `stale-claim-rejected` but the surrounding
  lifecycle metadata is inconsistent.
- That is useful release-path hardening, but it still does not prove a
  production-owned, non-lab-backed source mutation boundary on the real
  Reprint endpoint. The checked path remains the production-shaped verifier
  scaffolding; it still lacks live auth/session issuance and readback on the
  real endpoint, restart-readable durable journal storage with lease fencing
  on that same boundary, preserved rejected-remote evidence, and apply-time
  revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from stale-claim lifecycle hardening to the
  real production boundary on the checked release path: live auth/session
  issuance and readback, restart-readable durable journal storage with lease
  fencing, preserved rejected-remote evidence, and apply-time revalidation
  before mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
