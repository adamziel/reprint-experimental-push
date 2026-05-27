# Current Head a247efd1

- Audited commit: `a247efd1044ced53b7139698834ac1088310b251`
- Release-gate verdict: `0/4`

`a247efd1` adds a checked-path guard so the journal inspection fails closed when the auth envelope is missing. That is useful support-side hardening in the release-verifier path, but it still does not prove the missing production-owned real-endpoint boundary on the real Reprint source. The gate remains closed.

Next exact production primitive: one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence for audit, and apply-time revalidation before the first mutation.
