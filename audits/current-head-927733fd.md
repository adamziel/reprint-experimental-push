# Current Head 927733fd

- Audited commit: `927733fd00f96d28d1794d2dad6663feb8f3e557`
- Release-gate verdict: `0/4`

`927733fd` tightens the checked recovery fallback so stale-claim simulation requires proof that `staleClaimRejected` is true. That is a useful support-side hardening step in the checked client/verifier path, but it still does not prove the missing production-owned real-endpoint boundary on the real Reprint source. The gate remains closed.

Next exact production primitive: one checked live release command on the real Reprint endpoint that shows the exact live `REPRINT_PUSH_SOURCE_URL`, the same auth-session source command at issuance and readback, durable-journal `ownsJournal: true` plus `restartReadable: true` under lease-fenced ownership, preserved rejected-remote evidence for audit, and apply-time revalidation before the first mutation.
