# AO critic continuation 2 audit — 2026-05-28

Lane: `critic-continuation-2` (`session/rpp-23`)
Role: critic / evidence only
Base audited: `origin/lane/evidence-integration-20260527` at `25c667cd4` (`Refresh AO supervision handoff`)
Additional pushed heads inspected: `origin/session/rpp-10` `e74c12aee`, `rpp-13` `becc23804`, `rpp-14` `6b57056a3`, `rpp-18` `56a1e533b`, `rpp-19` `8f011c431`, plus docs-only/critic heads `rpp-15` `36b401c7e` and `rpp-16` `6454f931e`.

## Verdict

Final release remains **held**. The default integration branch still fails closed with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED` and release gates remain `0/4`. The useful new artifacts are support evidence, not production movement:

- `rpp-19` collects recovery-repair, release-gate CLI, redaction, and protocol-compatibility work, but is not merged into `origin/lane/evidence-integration-20260527`.
- `rpp-10` Docker proof is absent from both the lane and `rpp-19`; in this sandbox it proves only unavailable-capability fail-closed behavior because Docker is missing.
- `rpp-18` evidence coverage manifest is absent from both the lane and `rpp-19` and is too text-count based to trust as release coverage without stricter semantics.
- The broad authenticated push client suite is still red on the integration branch: `117 pass / 10 fail` in this audit.

Do not promote release readiness or mark checklist items complete from these branches until the evidence is wired into the release path, the auth suite is either fixed or honestly quarantined, and release-critical commands are green.

## Command evidence gathered in this audit

| Area | Command / inspection | Result |
| --- | --- | --- |
| Repo/branch state | `git fetch --prune origin`; `git log --oneline --decorate --graph --all --max-count=100` | `origin/lane/evidence-integration-20260527` remains at `25c667cd4`; recent pushed session heads include `rpp-10`, `rpp-13`, `rpp-14`, `rpp-18`, `rpp-19`, `rpp-15`, and `rpp-16`. |
| Branch ancestry | `git merge-base --is-ancestor origin/session/rpp-{10,13,14,18,19} origin/lane/evidence-integration-20260527` | None of these branch tips are ancestors of the lane. |
| Current integration release hold | `timeout 90s npm run verify:release` | Exit `1`; topology proof runs, live verifier fails closed with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`; `releaseMovement.allowed: false`, `gates: 0/4`, no source/local/changed URLs accepted. |
| Current release gate evaluator | `node --test test/release-gates.test.js` | 11/11 pass. Missing topology, packaged fallback, wrong alias, secret, stale operator evidence, and local-candidate-only evidence stay fail-closed. |
| Current auth suite | `node --test test/authenticated-http-push-client.test.js` | Exit `1`; 117 pass / 10 fail. Failures cover auth session lifecycle observation recording, preserved-remote retry precedence, consumed recovery-claim identity, recovery-journal fallback precedence, and durable-journal auth-envelope precedence. |
| Integration-worker presence | `git cat-file -e <ref>:<path>` for Docker harness, evidence manifest, release-gate CLI, redaction, protocol, repair files | Lane has none of these new files. `rpp-19` has release-gate CLI, redaction, protocol compatibility, and repair; it does not have Docker harness or evidence manifest. |
| Release CI wiring | `find .github ...`; `git grep check:release-gates/check-release-gates origin/session/rpp-19` | No workflow files found. `check:release-gates` exists only as a package script and evidence docs/tests; it is not part of `verify:release` or a required CI workflow. |
| Protocol wiring | `git grep negotiatePushProtocolCompatibility/protocolCompatibility/PUSH_PROTOCOL origin/session/rpp-19` excluding the new evaluator/test/fixture/doc | No actual JS push client, PHP REST route, or release verifier call to `negotiatePushProtocolCompatibility()`. Existing `PUSH_PROTOCOL_ERROR` strings are older route errors, not compatibility enforcement. |
| Checklist state | `grep -n "^- \[[xX]\]" docs/reprint-push-completion-checklist.md`; same against `rpp-19` | No checked boxes in either tree. This is the correct release posture, but progress/evidence docs still need to avoid overreading “advanced” RPP mentions as completion. |

## Critical findings

### 1. Release is honestly still held on the default lane

`timeout 90s npm run verify:release` on `25c667cd4` fails before any live source mutation path with `REPRINT_PUSH_LIVE_SOURCE_REQUIRED`. The emitted topology evidence reports no accepted source, local, remote-changed, or apply-revalidation URLs, `packagedFallbackAllowed: false`, and `releaseMovement.allowed: false` with `gates: 0/4`.

This is good fail-closed behavior. Keep `.agents/RELEASE_GATES.md` at `release_verdict: 0/4`; none of the reviewed branches should change that without a real production-owned source boundary.

### 2. Auth remains a release blocker, not merely a stale test expectation

The integration branch still has 10 failing subtests in `test/authenticated-http-push-client.test.js`. The failure themes are release-critical, not cosmetic:

- lifecycle observations stop after `dry-run` in the revoked/cleaned-up session recording test instead of preserving the expected apply/recovery/replay/journal observations;
- preserved-remote retry proof precedence is inconsistent with durable-journal and auth-session boundary precedence;
- a validated recovery-journal proof does not preserve consumed claim identity as expected;
- durable-journal readback without auth envelope reports auth lifecycle drift instead of the expected durable-journal boundary code in one case.

`rpp-19` does not modify `src/authenticated-http-push-client.js` or `test/authenticated-http-push-client.test.js`, so it cannot be treated as addressing these failures. Any release or integration report claiming a green release-critical test set is stale unless it excludes and explains these failures.

### 3. `rpp-19` is the useful integration worker, but it is still support-only

`rpp-19` contains functional equivalents of the redaction and protocol files from `rpp-13`/`rpp-14` plus release-gate CLI and recovery-repair work. It avoids the large accidental-looking test/planner deletions visible when diffing the standalone `rpp-13`, `rpp-14`, and `rpp-18` heads against `25c667cd4`.

However, `rpp-19` is not merged into the lane and leaves several tools standalone:

- `check:release-gates` is a package script only;
- protocol compatibility is a standalone JS evaluator/test/fixture;
- recovery repair is a standalone library/test/doc path;
- Docker and evidence-manifest work are missing entirely.

Treat `rpp-19` as an integration candidate requiring full test triage, not as shipped release evidence.

### 4. Release CI check lacks enforcement and evidence provenance

`rpp-19` adds `scripts/release/check-release-gates.mjs` and `npm run check:release-gates`, and the local tests prove held/local-candidate/final-release JSON behavior. That is useful, but the check is not actually enforced by CI in this repository: there is no `.github` workflow, and `verify:release` does not invoke `check:release-gates`.

The zero-exit path also accepts hand-authored JSON with `scope: "final-release"` and complete evidence objects. That is fine for a unit test, but not a release proof. Before this can gate release, the input must be bound to verifier provenance: command, exit status, artifact digest, source URL identity, auth readback, and non-packaged live-source evidence generated by the release verifier rather than supplied as arbitrary JSON.

### 5. Protocol compatibility is not enforced on real routes

`src/protocol-compatibility.js` in `rpp-19` has a strict standalone contract: unknown versions, downgrades, missing required capabilities, and capability extras fail closed. The gap is wiring. `git grep` shows no call to `negotiatePushProtocolCompatibility()` from the authenticated HTTP client, PHP REST plugin, playground routes, or release verifier.

Until the negotiated version/capability digest is required by preflight and rechecked at dry-run/apply/recovery, route/protocol compatibility remains documentation-level support. Also be careful with the field name `mutationAllowed: true` in the standalone evaluator: it currently means only “the capability offer matched the contract,” not “this request has release authority to mutate.”

### 6. Evidence redaction is valuable but has both over-blocking and under-blocking edges

`rpp-19` wires `redactEvidence()` into release-gate result evidence and `assertEvidenceHasNoRawValues()` into recovery journal append/readback. That improves the default posture for raw option/meta/post values and tokens.

Risks to address before broad integration:

- **Over-blocking:** any field normalized to `value`, `values`, `data`, or `payload` is blocked/redacted without inspecting whether it is benign diagnostic metadata. This can break legitimate hash-only or count-only artifacts unless consumers rename fields or tests cover those metadata shapes.
- **Under-blocking:** `SAFE_EVIDENCE_METADATA_KEYS` bypasses key-based redaction for names such as `productionSecret`, `authSourceCommandReadback`, and `authSessionSourceCommand`. If a future caller places a scalar secret or a shell command with embedded credentials under one of those keys and the string does not match the current token/URL heuristics, it may be preserved. PII/raw content under innocuous keys such as `title`, `name`, or `email` is also not caught unless the string matches one of the narrow patterns.
- **Coverage gap:** tests cover release-gate evidence and journal records, but not downstream progress/reporting artifacts that consume `releaseGateSummary()` or serialized evaluator output.

Integrate with compatibility tests for existing evidence consumers before relying on this as a universal no-leak guarantee.

### 7. Docker proof is fail-closed-only in this sandbox

`rpp-10` adds a well-scoped Docker local production harness and tests its plan shape: private Compose network, only `127.0.0.1:8080:80`, no tunnel strings, Docker DNS release URLs, and prerequisite probing. But the branch evidence itself records Docker missing in this sandbox and exits `2` with `DOCKER_CLI_MISSING` and `acceptedForReleaseGate: false`.

This is honest unavailable-capability evidence, not a Docker WordPress production pass. Additionally, the generated topology still mounts lab mu-plugins and uses fixture Application Passwords in disposable containers. A future Docker-capable pass would still be local production-shaped support unless the release gate explicitly distinguishes it from a production-owned non-lab source.

### 8. Evidence coverage manifest is brittle and not integrated

`rpp-18` adds `scripts/release/evidence-coverage-manifest.mjs`, but neither the default lane nor `rpp-19` contains it. The design is currently too weak for release claims:

- it scans only top-level `docs/evidence/*.md` and `audits/*.md`;
- any textual `RPP-####` mention counts as coverage, including critic warnings or “not complete” statements;
- `missingIds`, `duplicateEvidenceIds`, and `unknownEvidenceIds` are reported but do not make `ok` false in the representative test fixture;
- it does not check commands, exit statuses, artifact digests, or checklist success criteria.

Use it as an index at most. Do not use it to mark checklist items complete or to satisfy release coverage until it models evidence semantics and fails closed on stale/unknown/duplicate coverage as policy requires.

### 9. Checklist boxes remain unchecked, but progress claims need care

The checklist itself remains all unchecked on both `25c667cd4` and `rpp-19`, which matches the release hold. Some evidence/progress docs describe RPP items as “advanced” or local-candidate proof. That is acceptable only if not translated into completion. The manifest approach in `rpp-18` would blur that distinction by counting every RPP mention as coverage, so stale completion claims are still a process risk.

## Recommended integration order

1. Keep release gate state held and publish the `verify:release` fail-closed output as current evidence.
2. Fix or explicitly quarantine the 10 auth client failures before claiming integration green.
3. If integrating `rpp-19`, rerun at least: `node --test test/release-gates.test.js`, `test/evidence-redaction.test.js`, `test/protocol-compatibility.test.js`, `test/recovery-repair.test.js`, and the full/auth-critical suite; verify no accidental deletions from standalone `rpp-13`/`rpp-14`/`rpp-18` branches are pulled in.
4. Wire protocol compatibility into the actual preflight/dry-run/apply/recovery path before claiming route compatibility enforcement.
5. Wire `check:release-gates` into the real release command or required CI, and bind its input to generated verifier artifacts.
6. Keep Docker proof and evidence coverage manifest support-only until they run in the target environment and become release-path consumers rather than standalone tools.
