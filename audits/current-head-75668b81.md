# Current Head: `75668b81a33078611be1b8bb1f2e09da159ece10`

Audit time: 2026-05-27 01:40:50 CEST (+0200)

Status: `0/4`

Summary:
- `75668b81` only pins trusted scopes in `test/authenticated-http-push-client.test.js`.
- It does not change `verify:release`.
- It does not prove production-backed auth/session lifecycle on the checked release path.
- It does not prove production durable-journal ownership, lease/fencing, or restart-readable replay on the live boundary.

Evidence:
- Fixture hardening only: the diff is confined to the journal-client test.
- The checked release boundary remains unchanged from the prior live proof heads.
- The remaining gate still depends on production-owned durable-journal semantics or production-backed auth/session lifecycle.

Verdict:
- `0/4`
