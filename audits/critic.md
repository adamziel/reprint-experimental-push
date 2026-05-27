# Critic Verdict

Current reliable head: `ef5e52cec9072c278f751ff2fe0be78659912987`
(`Prefer checked release auth session reads`).

Verdict: `0/4`

Reason:

- This head tightens checked auth/session lifecycle evidence. The lifecycle
  summarizers now prefer release-boundary reads from `journal` or `replay` over
  later recovery-inspect observations, and the focused proof test covers that
  preference so recovery inspection cannot accidentally satisfy the checked
  release read boundary.
- That is material auth/session evidence hardening, but it still runs inside
  the production-shaped Playground/package harness. It does not yet prove the
  same release-boundary auth/session read on a real Reprint endpoint with
  durable journal ownership, preserved rejected-remote evidence, and apply-time
  revalidation before mutation. Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should turn this release-boundary read preference into
  the next exact production primitive: a non-lab-backed source mutation /
  auth-session boundary on the real Reprint endpoint that issues a live
  session, reads it back from restart-readable durable journal storage,
  enforces lease-fenced ownership of those journal rows, preserves
  rejected-remote evidence, and revalidates the session at apply time before
  mutation without falling back to Playground package-mode scaffolding. The
  proof should come through
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and `src/authenticated-http-push-client.js` with
  `timeout 300s npm run verify:release`.
