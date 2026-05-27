# Critic Verdict

Current reliable head: `e4486374ac0c4de784e103bfbdff6d6054933873`
(`Mirror validated recovery journal surface`).

Verdict: `0/4`

Reason:

- This head mirrors a validated recovery journal surface into the checked
  authenticated client summary. In `src/authenticated-http-push-client.js` it
  recognizes `production-recovery-journal` recovery-inspect data, carries the
  validated `journal`, `claim`, and `leaseFence` surface into the summary, and
  rejects untrusted recovery-inspect journal data with
  `RECOVERY_INSPECT_JOURNAL_UNTRUSTED`.
- In `src/recovery-journal.js` it adds the production recovery journal
  inspection contract and extends stale-claim metadata handling so the checked
  release path can recognize a richer validated journal surface.
- That is still release-path support evidence, not a supervised gate closure.
  The checked path remains verifier/scaffold-driven, and this head still does
  not prove a production-owned, non-lab-backed source mutation boundary on the
  real Reprint endpoint with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should land the next exact primitive beyond recovery
  journal surface mirroring: a production-owned, non-lab-backed
  source-mutation/auth-session boundary on the real Reprint endpoint that
  issues a live session on the endpoint, reads it back after restart from
  durable journal storage, enforces lease-fenced ownership of those journal
  rows, and revalidates the session at apply time before mutation without
  falling back to Playground package-mode scaffolding. The proof should come
  through `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
