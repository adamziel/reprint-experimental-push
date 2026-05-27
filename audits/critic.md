# Critic Verdict

Current reliable head: `4b4f9393610f86742e41426b9f95b99082adf70f`
(`Prove apply revalidation retry boundary`).

Previous classified reliable head: `d9ec5130979968098ac7b16b93220bd0d3fdbe38`
(`Preserve live source in release wrapper`).

Verdict: `0/4`

Reason:

- I repolled `origin/lane/reliable-executor` and confirmed it points at
  `4b4f9393610f86742e41426b9f95b99082adf70f`.
- The `d9ec5130..4b4f9393` delta stays inside the apply-revalidation smoke and
  its proof test. It adds a preserved-remote retry simulation path, proves the
  packaged live proof can reach a second `/snapshot` attempt, and now reports
  `PRESERVED_REMOTE_RETRY_PROVEN` with `LIVE_RELEASE_BOUNDARY_OK` when the
  retry count reaches two.
- That is useful verifier hardening, but it still remains packaged/live proof
  scaffolding. The evidence is still bounded to the smoke path and proof test,
  not one rerunnable checked release command on the real Reprint endpoint where
  the same executable command mints and reads back a live auth session on the
  real source URL, persists it in durable restart-readable journal storage with
  lease-fenced ownership, preserves the rejected remote evidence for audit, and
  performs apply-time revalidation before the first mutation on that same live
  boundary.
- So the verdict remains `0/4`: `4b4f9393` proves preserved-remote retry on the
  packaged apply-revalidation path, but it still does not prove the missing
  production-owned, non-lab-backed checked release boundary.

Next exact reliable-owned primitive:

- One production-owned, non-lab-backed checked release command on the real
  Reprint endpoint where the exact executable command string and exact live
  `REPRINT_PUSH_SOURCE_URL` are visible, that same executable command mints
  and then reads back a live auth session on that real source URL, persists
  it in durable restart-readable journal storage with lease-fenced ownership,
  preserves the rejected remote evidence for audit, and performs apply-time
  revalidation before the first mutation on that same live boundary.
