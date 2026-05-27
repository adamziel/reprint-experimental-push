Audited `13367763db66c5b145d507c5cf91c476b4b72efc` (`Infer checked journal storage guards`).

Verdict: `0/4`

What changed:
- `src/authenticated-http-push-client.js` now calls `inferTrustedDbJournalStorageGuard()` from `summarizeDbJournalStorageGuard()` and from recovery-journal summarization so the client can synthesize a trusted `storageGuard` when the checked journal metadata already agrees on one boundary.
- `inferTrustedDbJournalStorageGuard()` only returns a storage guard when `ownership.ownsJournal === true`, `ownership.restartReadable === true`, and all checked boundary signals agree across `ownership.productionAdapter`, `leaseFence.boundary`, `writerLease.storageGuard`, and `leaseFence.writerLease.storageGuard`.
- `test/authenticated-http-push-client.test.js` adds a regression that accepts the all-`wpdb-single-statement-cas` case and rejects a mixed `filesystem-compare-rename` boundary.

Why it does not move the gate:
- This is client-side interpretation of checked proof, not new production-owned endpoint behavior. The diff does not add a real Reprint endpoint, a new release command, or a live production-boundary run.
- The trusted boundary is still inferred from proof fields that already existed on the packaged checked path. That hardens proof consumption, but it does not show the named boundary is actually owned by a production endpoint across issuance, mutation, crash, replay, and readback.
- The new regression is a unit test for helper behavior. It does not prove live auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, Playground-independent plugin-driver proof, preserved rejected-remote evidence, or apply-time revalidation before first mutation on the real boundary.

Evidence reviewed:
- `13367763:src/authenticated-http-push-client.js`
- `13367763:test/authenticated-http-push-client.test.js`
- `ed1e09af6b22b0b96a795b3cc5e1e1f34094edef` (`Classify reliable head 13367763`)

Critic alignment:
- `origin/lane/critic` at `ed1e09af6b22b0b96a795b3cc5e1e1f34094edef` also keeps the verdict at `0/4`, and this audit agrees.

Next blocker:
- One checked live release run on the real Reprint endpoint must still prove live auth/session issuance/readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership on the release boundary, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
