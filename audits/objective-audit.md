# Objective Audit

## Verdict

- Audited commit: `f28ff529e542875510e9343f0314366f5526cd8d` (`Fail closed on malformed recovery auth identities`)
- Previous audited reliable head: `401ee0b3ac3d17ef3599627e99ca4db906df8a83`
- Latest reliable diff reviewed: `401ee0b3ac3d17ef3599627e99ca4db906df8a83..f28ff529e542875510e9343f0314366f5526cd8d`
- Reliable advanced since the supervisor baseline: `no`
- Current critic head: `02890172771c3effe2c44494eeef00c12f719b8e`
- Critic verdict availability: `stale 0/4 for 401ee0b3, no critic verdict yet for f28ff529`
- Release-gate verdict: `0/4`
- The project is **not yet releasable as a production WordPress push path**.

- Audit time: 2026-05-27 07:45:09 CEST (+0200)
- Fresh remote heads re-polled at audit time:
  - `origin/lane/reliable-executor` -> `f28ff529e542875510e9343f0314366f5526cd8d` (`Fail closed on malformed recovery auth identities`)
  - `origin/lane/critic` -> `02890172771c3effe2c44494eeef00c12f719b8e` (`Classify reliable head 401ee0b3`)
  - `origin/lane/independent-auditor` -> `35ccddb7b33d649d83086fd6d0956dcecdf1c55b`
  - `origin/main` -> `1c7ccf9e8d5f6b6974f6ee4ceb92840d34391565`

## Evidence Table

| Requirement | Current proof | Missing proof | Verdict impact |
| --- | --- | --- | --- |
| Recovery auth identity validation | `src/authenticated-http-push-client.js` now rejects malformed observed `auth.identity.userId` values during recovery inspection, keeps `userLogin` malformed handling, and threads the precise required-field description into preflight, dry-run, apply, recovery-inspect, replay, DB-journal, and drift summaries. | A production-owned endpoint that proves those auth/session identity checks are enforced on the real Reprint mutation boundary with live session issuance and readback. | Support-only |
| Recovery-inspect fail-closed regression coverage | `test/authenticated-http-push-client.test.js` now covers malformed recovery-inspect `userLogin` and `userId` payloads even when the stricter production-session gate would not be the first failing condition, and asserts `AUTH_SESSION_LIFECYCLE_DRIFT` before the client proceeds to durable-journal readback. | One checked live run showing the same malformed identity refusal and exact evidence payload on the real endpoint, not only in the client test harness. | Support-only |
| Production-owned auth/session lifecycle | `f28ff529` improves client-side malformed identity rejection, but it does not add a production auth/session issuer, live session store, or endpoint-owned session readback on the same mutation boundary. | One checked live run on the real endpoint proving auth/session issuance, readback, expiry or rotation handling, and stale-session refusal on that same boundary. | Blocked |
| Durable journal ownership with lease fencing and restart-readable replay | The new tests stop earlier on malformed recovery auth identity drift, which is useful safety hardening, but they do not add production-owned journal storage, lease fencing, or restart-readable replay evidence on the real endpoint. | Real endpoint proof that the durable journal is production-owned, lease-fenced, crash-readable after restart, and tied to the same live boundary being audited. | Blocked |
| Plugin-driver ownership | No plugin-driver contract, plugin-owned resource validator, or release-boundary plugin proof changed in `f28ff529`. | Real boundary proof for plugin-driver ownership and conservative blocking or validation of plugin-owned state on the release path. | Blocked |
| Preserved rejected-remote evidence and first-mutation revalidation | `f28ff529` improves malformed recovery identity evidence with more precise `required` strings, but it still does not prove preserved rejected-remote evidence or apply-time revalidation before first mutation on a production-owned endpoint. | One checked live run on the real endpoint proving preserved rejected-remote evidence plus apply-time revalidation before first mutation on that same production boundary. | Blocked |

## Release Blockers

1. `f28ff529` is useful auth/session drift hardening in the authenticated HTTP push client, especially for malformed recovery-inspect `userId` and `userLogin` payloads.
2. The diff is still limited to client-side validation and regression tests. It does not create a production-owned auth/session lifecycle, a real endpoint-owned durable journal, or plugin-driver ownership evidence on the release boundary.
3. The current critic lane is stale for this head. Its `0/4` result for `401ee0b3` is directionally consistent with this audit, but it is not independent classification of `f28ff529`.
4. The required checked live release primitive is unchanged: one run on the real Reprint endpoint must prove auth/session issuance and readback, durable restart-readable journal ownership with lease fencing, plugin-driver ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation on that same boundary.

## Critic Status

`origin/lane/critic` currently points at `02890172771c3effe2c44494eeef00c12f719b8e`, which classifies `401ee0b3` at `0/4`. That verdict is stale for `f28ff529`, but the narrow scope of this diff does not present evidence that would justify any release-gate increase.

## Next Primitive

The next exact production primitive remains one checked live release command on the real Reprint endpoint that proves all of the following together on the same boundary:

1. live auth/session issuance and readback
2. durable restart-readable journal ownership with lease fencing
3. plugin-driver ownership on the release boundary
4. preserved rejected-remote evidence
5. apply-time revalidation before the first mutation

Until that exists, the release-gate verdict stays `0/4`.
