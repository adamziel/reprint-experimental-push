# AO route proof matrix evidence

Date: 2026-05-28
Lane: route-proof-matrix
Primary checklist range: RPP-0011 through RPP-0015

## What changed

- Added `src/route-proof-matrix.js`, a deterministic contract builder and validator for the production push route surface.
- Added `fixtures/protocol/push-route-proof-matrix-contract.json`, a machine-readable fixture with stable route ordering.
- Added `test/route-proof-matrix.test.js`, including negative fail-closed coverage for wrong method, missing identity, missing capability evidence, and contradictory mutation boundaries.

The matrix does not contact a live external service. It proves the expected route contract that release evidence can cite before relying on live preflight, dry-run, apply, journal, or recovery evidence.

## Route contract summary

| Route | Method(s) | Permission floor | readOnly | mutates | Boundary |
| --- | --- | --- | --- | --- | --- |
| `preflight` | `GET` | `manage_options` via authenticated permission callback | `false` | `false` | Protocol/session state only; no content, file, database resource, durable journal, or recovery-state mutation. |
| `dry-run` | `POST` | `manage_options` via authenticated permission callback | `false` | `false` | Eligibility receipt only; not a lock and not apply authority. |
| `apply` | `POST` | `manage_options` via authenticated permission callback | `false` | `true` | Content-mutating write route; must revalidate before every batch and storage boundary. |
| `journal` | `GET` | `manage_options` via authenticated permission callback | `true` | `false` | Read-only durable journal inspection; cannot append, repair, finalize, or roll back. |
| `recovery-inspect` | `POST` | `manage_options` via authenticated permission callback | `true` | `false` | Read-only classification before any repair. |
| `recovery-repair` | `POST` | `manage_options` via authenticated permission callback | `false` | `true` | Mutating finish/rollback path only after inspect-first evidence, journal fences, and fresh live hashes. |

## Fail-closed evidence

The validator rejects route proof entries when any required evidence is absent or contradictory. Focused cases covered in `test/route-proof-matrix.test.js`:

- `apply` marked read-only -> `ROUTE_MUTATION_BOUNDARY_MISMATCH`.
- `journal` marked mutating -> `ROUTE_MUTATION_BOUNDARY_MISMATCH`.
- Missing capability evidence -> `ROUTE_CAPABILITY_EVIDENCE_REQUIRED`.
- Wrong method -> `ROUTE_METHOD_MISMATCH`.
- Missing route identity -> `ROUTE_IDENTITY_REQUIRED`.

Each failure includes a `failClosedReason` so release evidence can explain why the route proof is not trusted.

## Covered RPP items with repository evidence

| RPP item | Evidence added |
| --- | --- |
| RPP-0011 | `preflight` route identity, method, permission floor, and pre-mutation boundary are modeled and fixture-verified. |
| RPP-0012 | `dry-run` route eligibility boundary is modeled as a POST receipt that cannot authorize apply. |
| RPP-0013 | `apply` route is modeled as mutating and fails closed if marked read-only or missing pre-mutation evidence. |
| RPP-0014 | `journal` route is modeled as GET/read-only and fails closed if marked mutating. |
| RPP-0015 | `recovery-inspect` is modeled as read-only inspect-before-repair evidence, with `recovery-repair` split out as the later mutating boundary. |

## Focused verification

```sh
node --check src/route-proof-matrix.js
node --check test/route-proof-matrix.test.js
node --test test/route-proof-matrix.test.js
git diff --check
```

Expected status: all commands pass.
