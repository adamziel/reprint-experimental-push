# Critic Verdict

Current reliable head: `a86328d648354ec5e29f75145be59c20079c3ba9`
(`Keep final retry evidence for preserved reads`).

Verdict: `0/4`

Reason:

- This head keeps preserved-read retry evidence on the checked client path by
  tracking the latest retry attempt for read probes and extending the replay /
  journal assertions around the final preserved-remote read.
- It also adds more checked-path auth/session and durable-journal assertions in
  the client tests, including a fail-closed case when the final read retries
  before the preserved remote read completes.
- That is still release-path hardening, not the missing production-owned
  source mutation boundary. The checked path remains the Playground/package
  verifier scaffolding, and this head still does not prove a real Reprint
  endpoint mutation boundary with live auth/session issuance and readback,
  restart-readable durable journal storage with lease fencing, and apply-time
  revalidation before mutation.
- Verdict therefore remains `0/4`.

Next owner / command:

- `main:reliable-exec` should use this only as support evidence and keep
  moving toward the real checked release boundary: a production-owned,
  non-lab-backed `verify:release` path that, on the same live
  `REPRINT_PUSH_SOURCE_URL`, mints and rereads a live auth session, persists
  it in durable restart-readable lease-fenced journal storage, preserves
  rejected remote evidence, and performs apply-time revalidation before the
  first mutation. The relevant proof path remains
  `scripts/playground/production-shaped-release-verify.mjs`,
  `scripts/playground/push-remote-rest-plugin.php`,
  `src/recovery-journal.js`, and
  `src/authenticated-http-push-client.js` under `timeout 300s npm run
  verify:release`.
