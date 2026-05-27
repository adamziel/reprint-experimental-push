# Current Head Audit

- Audited head: `bc4679930d9d27adfb84b49b075816ff2e4d9ead` (`Tighten replay auth session equivalence`)
- Verdict: `0/4`
- This commit materially tightens auth/session replay evidence: replay equivalence now compares revoked, cleaned-up, rotated, preserved, and expired lifecycle state and reports field-level mismatches such as `authSessionPreserved`.
- It still does not prove one production-owned real-endpoint boundary with auth/session issuance and readback, durable restart-readable journal ownership, preserved rejected-remote evidence, and apply-time revalidation before the first mutation.
- Release gates remain closed pending that production-owned proof.
