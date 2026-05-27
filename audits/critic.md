# Critic Verdict

Current reliable head: `6734e8368c0299e665957757207e883c35186227`
(`Require checked journal proof on release path`).

Verdict: `0/4`

Reason:

- This head wires `checkedDurableJournalBoundarySatisfied()` into the checked
  release-path journal proof when `requireProductionAuthSession` is enabled.
  That tightens the verifier so the release path now requires the checked
  journal boundary instead of only the broader trusted-scope predicates.
- That is useful checked-path hardening, but it still runs inside the
  production-shaped Playground/package harness. It does not yet prove the
  missing production-owned source mutation boundary on the real Reprint
  endpoint with live auth/session issuance and readback, restart-readable
  durable journal storage with lease fencing, preserved rejected-remote
  evidence, and apply-time revalidation before mutation. Verdict therefore
  remains `0/4`.

Next owner / command:

- `main:reliable-exec` should move from checked journal-proof gating to the
  real production boundary on the checked release path: live auth/session
  issuance and readback, restart-readable durable journal storage with lease
  fencing, preserved rejected-remote evidence, and apply-time revalidation
  before mutation. The proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
