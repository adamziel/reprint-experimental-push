# Current Head a86328d6

- Audited commit: `a86328d648354ec5e29f75145be59c20079c3ba9`
- Release-gate verdict: `0/4`

`a86328d6` keeps the checked client’s preserved-read retry evidence intact by preferring the last retry evidence when the same path is read again after fallback. That is useful support-side hardening in the release-verifier path, but it still does not prove the missing production-owned real-endpoint boundary on the real Reprint source. The gate remains closed.

Next exact production primitive: one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence for audit, and apply-time revalidation before the first mutation.
