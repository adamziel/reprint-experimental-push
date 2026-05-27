Audited `e9c9e36980b738f584eadf113ff5599ce885cd39` (`Fail closed on stale-claim lifecycle drift`).

Verdict: `0/4`

What changed:
- `src/authenticated-http-push-client.js` now records more stale-claim lifecycle detail in auth/session summaries, including invalid lifecycle flags plus explicit unrevoked and expired field provenance.
- `src/recovery-journal.js` now rejects checked journal claim contracts when `claim.status`, `claim.activeClaimEvent`, and `claim.staleClaimRejected` disagree.
- `test/authenticated-http-push-client.test.js` adds a production-shaped mocked fetch scenario where `/recovery/inspect` and `/db-journal` claim stale-claim rejection while the claim payload still says `staleClaimRejected: false`; the client still fails closed with `DURABLE_JOURNAL_NOT_PROVEN`.
- `test/recovery-journal.test.js` adds coverage that the checked durable-journal boundary stays closed when stale-claim lifecycle metadata drifts even if the surrounding lease-fence fields look acceptable.

Why it does not move the gate:
- This is still proof-shape hardening. The main new executable evidence is a mocked production-shaped client flow, not a production-owned real Reprint endpoint.
- The journal contract is stricter, but the proof remains packaged/lab-scoped instead of showing durable restart-readable journal ownership with lease fencing on the real boundary.
- The diff does not prove live auth/session issuance and readback, preserved rejected-remote evidence, or apply-time revalidation before first mutation on that same boundary.

Critic alignment:
- `origin/lane/critic` at `b65ef92b468745ef9baba7c12b5bc65938b2a977` also keeps the verdict at `0/4` for the same reason: better fail-closed stale-claim accounting, no production-owned endpoint proof.

Next blocker:
- One checked live `verify:release` run on the real Reprint endpoint must prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.
