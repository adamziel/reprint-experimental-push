# Recovery State Matrix

The atomic apply path in this lane only accepts three post-failure outcomes:

- `old-remote`
- `fully-updated-remote`
- `blocked-recovery`

The safe outcome depends on where the interruption happened:

| Failure point | Acceptable state | Required artifacts |
| --- | --- | --- |
| Before mutation | `old-remote` | Recovery journal describing the planned mutation set |
| After staging | `old-remote` | Recovery journal plus staged boundary evidence |
| After dependency validation | `old-remote` | Recovery journal plus validated boundary evidence |
| Completed-plan replay | `fully-updated-remote` | Completed journal replay evidence |
| Partial or ambiguous recovery | `blocked-recovery` | Journal plus remote artifacts that explain the drift |

Rules that matter for recovery safety:

- A partial remote mutation without a recovery artifact is a release blocker.
- Retrying a completed plan must not duplicate inserts.
- Retrying a completed plan must not resurrect stale local data.
- If recovery inspection cannot prove safety, the result must remain blocked.

This file is intentionally narrow. It records the contract that the tests in
`test/push-planner.test.js` enforce.
