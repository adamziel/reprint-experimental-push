# Release Proof Matrix

This matrix maps the objective requirements to the evidence buckets that matter for release.
It is intentionally strict: lab-backed, fixture-only, and benchmark-only checks do not count as release proof.

| Requirement | Executable proof | Lab / fixture proof | Docs-only proof | Missing proof | Release blocker |
| --- | --- | --- | --- | --- | --- |
| One-way pull base, then one-way push to live source | No current test proves a live-source push path from real remote state back to the source boundary | Playground and route smokes exercise local or fixture-backed flows only | Audit notes describe the intended flow | No required command proves the live-source boundary end to end | Yes |
| Recheck live source at apply time before mutating it | Fixture tests cover planner and replay shape, not the production apply boundary | Smokes cover stale-claim and storage-guard scenarios in lab mode | Docs describe the safety intent | No live mutation gate is enforced on the real source | Yes |
| Preserve all touched WordPress data shapes | Current tests do not exercise all production data shapes under a real push | Smokes do not prove rows, files, plugin-owned data, serialized payloads, or graph identity on live storage | Docs list the intended scope | No production data-shape preservation proof exists | Yes |
| Survive crash, retry, replay, duplicate request, stale claim, lease expiry, and mid-apply restart | Recovery and journal tests are local-file or model-backed | Lab smokes cover some restart and stale-state scenarios | Audit notes describe the failure classes | No live crash-boundary proof on the source boundary | Yes |
| Enforce auth/session, durable journal, leases/fencing, storage, graph identity, plugin-data-driver checks at release boundary | Some refusal tests and smokes cover individual guardrails | The strongest authenticated path still reports `labBacked: true` | Audit prose enumerates the checks | No single enforced release command composes them | Yes |
| Prove real remote/local topology, not just a local Playground route or alias | No current executable proof uses the real topology | Existing smokes are explicitly lab-scoped | Docs call out the desired topology | No checked-in release gate validates topology on the live path | Yes |
| Publish a measured speed claim or explicitly refuse to make one | Benchmark-model and guarded-benchmark tests refuse unsupported claims | No live-path throughput measurement is present | Audit notes refuse the claim | No production-speed threshold is verified, so the repo still cannot claim speed | Yes |
| Expose one required release command that fails closed on any unsafe bucket | Upstream reliable-executor evidence reportedly passes `npm run verify:release` with live preflight, dry-run, apply, recovery inspect, and journal readback | Optional smokes exist here, but they are not mandatory in this checkout | Audit notes describe the needed gate | This checkout still does not own a checked live-boundary verdict or an equivalent enforced local entrypoint | Yes |
| Wire the release command into CI or another default entrypoint | No checked-in workflow exists in this checkout | None | Audit notes mention the absence | No enforced automation path exists in this checkout | Yes |

## Operational Rule

If the best evidence is `labBacked: true`, fixture-only, benchmark-only, or prose-only, treat the requirement as unproven.
Only executable proof on the live-source boundary can clear the blocker.
