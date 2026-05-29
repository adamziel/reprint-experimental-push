# RPP-0901 release gate 1 final audit

Date: 2026-05-29
Audited local branch: `session/rpp-63`
Audited lane head before this evidence file: `93c391cd9913af4019fcf962b60e871982b347ef`
Checklist item: RPP-0901 — Implement release gate 1 final audit, variant 1.
Write scope: release-ops audit evidence for GATE-1 only.

## Gate under audit

GATE-1 is the Production Executor/Auth Boundary from `.agents/RELEASE_GATES.md`.
The gate requires a production-owned, non-lab-backed source boundary that proves
preflight, dry-run, apply, auth/session issuance, auth/session readback,
request integrity, and capability/identity binding on the same live source URL.

## Audit verdict

Release movement stays held for GATE-1. The current lane has executable support
and carry-through coverage for auth/session, credential binding, capability,
same-source identity, and route pre-mutation checks, but the canonical release
verifier still fails closed without `REPRINT_PUSH_SOURCE_URL` and without final
production-scoped auth/source evidence. GATE-1 status therefore remains
`support_only`, and the aggregate release verdict remains `0/4`.

## Exact commands run in this audit

| Purpose | Exact command | Exit | Observed evidence |
| --- | --- | ---: | --- |
| Audited commit | `git rev-parse HEAD` | 0 | `93c391cd9913af4019fcf962b60e871982b347ef` |
| Gate-1 commit context | `git log --oneline --max-count=20 -- .agents/RELEASE_GATES.md docs/evidence/ao-release-gates.md src/release-gates.js scripts/release/check-release-gates.mjs test/authenticated-http-push-client.test.js test/release-gate-auth-source-readback-regression.test.js test/release-gate-missing-production-secret-regression.test.js test/release-gate-application-password-binding-regression.test.js test/release-gate-manage-options-capability-regression.test.js test/release-gate-same-source-identity-regression.test.js test/release-gate-preflight-route-identity-regression.test.js test/release-gate-dry-run-route-eligibility-regression.test.js test/release-gate-route-recovery-focused-regression.test.js test/release-verifier-auth-source-readback-carry-through-focused-regression.test.js test/release-verifier-missing-production-secret-carry-through-focused-regression.test.js test/release-verifier-application-password-binding-carry-through-focused-regression.test.js test/release-verifier-manage-options-carry-through-focused-regression.test.js test/release-verifier-same-source-carry-through-focused-regression.test.js test/release-verifier-preflight-route-carry-through-focused-regression.test.js test/release-verifier-dry-run-route-carry-through-focused-regression.test.js test/release-verifier-apply-route-carry-through-focused-regression.test.js` | 0 | Recent gate-1/carry-through commits listed in the commit table below. |
| Gate-1 full commit hashes | `git show -s --format='%H %s' 3ff789513 bb40db8c1 2849d0398 6e3ab6f3c e837c3b90 adc70a4fc 847a4281c bb01b0552 d5e8bb491 45da34eca c3f7a3703 4b459c956 2891399d3` | 0 | Exact commits listed in the commit table below. |
| Focused executor/auth and route-boundary checks | `node --test test/release-gates.test.js test/release-gate-cli.test.js test/authenticated-http-push-client.test.js test/release-gate-auth-source-readback-regression.test.js test/release-gate-missing-production-secret-regression.test.js test/release-gate-application-password-binding-regression.test.js test/release-gate-manage-options-capability-regression.test.js test/release-gate-same-source-identity-regression.test.js test/release-gate-preflight-route-identity-regression.test.js test/release-gate-dry-run-route-eligibility-regression.test.js test/release-gate-apply-route-pre-mutation-generated.test.js test/release-verifier-auth-source-readback-carry-through-focused-regression.test.js test/release-verifier-missing-production-secret-carry-through-focused-regression.test.js test/release-verifier-application-password-binding-carry-through-focused-regression.test.js test/release-verifier-manage-options-carry-through-focused-regression.test.js test/release-verifier-same-source-carry-through-focused-regression.test.js test/release-verifier-preflight-route-carry-through-focused-regression.test.js test/release-verifier-dry-run-route-carry-through-focused-regression.test.js test/release-verifier-apply-route-carry-through-focused-regression.test.js` | 0 | TAP summary: `tests 195`, `pass 195`, `fail 0`. |
| Final-scope release-gate evaluator | `node scripts/release/check-release-gates.mjs --scope final-release --now 2026-05-29T03:27:10.000Z` | 1 | `releaseStatus: NO-GO`; `primaryFailureCode: REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `statusMarker: [release-gates-ci:held final=3/20 candidate=3/20 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED]`; `mutationAttempted: false`. |
| Canonical release verifier | `timeout 300s npm run verify:release` | 1 | `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `[verify-release:held exit=1 reason=REPRINT_PUSH_LIVE_SOURCE_REQUIRED mutationAttempted=false]`; `releaseMovement.allowed: false`; `gates: 0/4`; no source/local/changed service URL was accepted. |
| Gate status row readback | `node scripts/release/agents-release-gates-status-row.mjs .agents/RELEASE_GATES.md` | 0 | `releaseVerdict: 0/4`; GATE-1 title `Production Executor/Auth Boundary`; GATE-1 status `support_only`; all four gates `support_only`. |

## Exact commit links audited for GATE-1 support evidence

| Boundary evidence | Commit |
| --- | --- |
| Auth session live source boundary | `3ff7895136b46cd2998b28c5d148a242cb41107c` — Prove auth session live source boundary |
| Read-only inspect auth | `bb40db8c1d97a4971fe8483b7acb8ae8b6e66d77` — Prove executor read-only inspect auth |
| Auth/recovery integration reconciliation | `2849d0398a3afb3c79eaea06b5a5bd1adb19904b` — fix: reconcile auth and recovery integration evidence |
| Cleanup flag fail-closed behavior | `6e3ab6f3c2cd6b0a873562eb60acf2d33aca9c4a` — Fail closed on underscore cleanup flags |
| Auth source command readback carry-through | `e837c3b9043f3ce2ebf5d8605a47253fc33570c5` — Carry release verifier auth readback evidence |
| Missing production credential carry-through | `adc70a4fc034f72d6bc0897552f930df3d5a00b8` — Carry release verifier missing secret evidence |
| Application Password binding carry-through | `847a4281c6de4e4fef22d247e66435453292b28a` — Add RPP-0088 verifier credential binding proof |
| `manage_options` carry-through | `bb01b0552c115548554d435745a83f5daf6fee79` — Add RPP-0089 verifier manage options proof |
| `manage_options` scenario matrix | `d5e8bb491d29712d3580b7a08aa0bad22c10a869` — Add manage options scenario matrix evidence |
| Same-source identity carry-through | `45da34eca069d2e96297e9018928a2c415d90870` — fix: carry same-source identity through release verifier |
| Preflight route identity carry-through | `c3f7a37037f6d4f2455d3ac24078a0e1288bf87a` — fix: carry preflight route identity verifier evidence |
| Dry-run route eligibility carry-through | `4b459c9568ad980eca641f49ab028d83984bc26d` — test: carry dry-run route eligibility through verifier |
| Apply route pre-mutation carry-through | `2891399d3661798021bd156f0799268c1671497e` — test: add RPP-0093 apply route verifier carry-through |

## GATE-1 coverage map

| GATE-1 requirement | Current lane evidence | Current audit finding |
| --- | --- | --- |
| Auth/session issuance and readback on the same source | `test/authenticated-http-push-client.test.js`; auth-source readback regression and release-verifier carry-through tests | Support evidence exists, including fail-closed drift checks; final production source evidence is absent. |
| Request integrity for mutating routes | `test/authenticated-http-push-client.test.js` signs mutating requests with session and idempotency evidence | Support evidence exists; final production-scoped command still lacks a live source. |
| Capability binding | `test/release-gate-manage-options-capability-regression.test.js`; `test/release-verifier-manage-options-carry-through-focused-regression.test.js` | Support evidence exists for denial and capable-user paths; final production operator evidence is absent. |
| Credential binding | `test/release-gate-application-password-binding-regression.test.js`; `test/release-verifier-application-password-binding-carry-through-focused-regression.test.js` | Support evidence exists for binding drift and bound paths; no production credential artifact is recorded in this audit. |
| Same-source identity across preflight, dry-run, apply, journal, and recovery | `test/release-gate-same-source-identity-regression.test.js`; `test/release-verifier-same-source-carry-through-focused-regression.test.js` | Support evidence exists for drift refusal and matching identity; final source URL evidence is absent. |
| Preflight, dry-run, and apply route boundary | Preflight, dry-run, and apply carry-through focused tests plus generated apply pre-mutation test | Support evidence exists for fail-closed route evidence; canonical release verifier halts before live route execution because the source URL is missing. |

## Caveats and next integration recommendation

- This audit records the current lane state only. It does not move GATE-1 out of
  `support_only`.
- The canonical release verifier stopped before mutation with
  `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; this is the expected fail-closed result
  when no production-owned source URL is supplied.
- The focused test command is local executable support evidence. It is not a
  substitute for a final production run with `REPRINT_PUSH_SOURCE_URL`,
  `REPRINT_PUSH_LOCAL_URL`, `REPRINT_PUSH_REMOTE_CHANGED_URL`, and production
  auth/session evidence.
- No remote tunnel was used. The verifier output continued to identify sandbox
  ingress `8080` and no accepted source/local/changed service ports.
- Integrate this audit as release-ops evidence for RPP-0901 only. The next
  release-gate-1 movement should require a zero-exit canonical verifier run on a
  production-owned source boundary with fresh provenance for the auth/session,
  capability, identity, preflight, dry-run, and apply evidence.
