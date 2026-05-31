# RPP-0448 serialized option validator variant 3 evidence

Date: 2026-05-31
Lane: RPP-0448 serialized option validator, variant 3
Checklist item: RPP-0448 - Add generated coverage for serialized option validator, variant 3.

## Scope

This is local plugin-driver support evidence for a generated-style
plugin-owned `wp_options` serialized option validator proof. It adds a
standalone Node test and does not change production code, progress surfaces, or
release checklist state.

Final release remains `NO-GO`. This proof is not live external production
evidence.

## Proof surface

`test/rpp-0448-serialized-option-validator-v3.test.js` proves:

- exact PHP serialized option validation for a plugin-owned `wp-option` row,
  including `SERIALIZED_OPTION_VALID` for matching base, local, and remote rows;
- one scoped `row:["wp_options","option_name:forms_rpp_0448_serialized_state"]`
  mutation carries owner `forms`, driver `wp-option`, `supportsDelete: false`,
  and one matching `live-remote` precondition;
- local apply with `mutateRemote: true` carries exactly one real mutation
  through `applyPlan()`, reaches accepted driver apply-validation evidence once,
  updates the target row to the local row hash, and preserves an unplanned live
  sibling option drift;
- a stale live remote target row refuses before mutation with
  `PRECONDITION_FAILED`;
- an invalid local serialized payload is blocked in planning with
  `invalid-plugin-driver-payload` and `SERIALIZED_OPTION_STRING_LENGTH_MISMATCH`;
- a forged ready plan carrying an invalid serialized payload refuses apply with
  `INVALID_PLUGIN_DRIVER_PAYLOAD` before the mutation hook; and
- planner validation evidence, driver payload validation evidence, apply
  validation evidence, stale/invalid refusal details, apply journal entries,
  and proof envelopes remain hash-only or identifier-only. Raw serialized
  option payloads and `option_value` fields are excluded from those evidence
  surfaces.

## Focused verification observed locally

```sh
node --check test/rpp-0448-serialized-option-validator-v3.test.js
node --test test/rpp-0448-serialized-option-validator-v3.test.js
node --test --test-name-pattern 'RPP-0448|RPP-0468|RPP-0488' test/push-planner.test.js
node --test --test-name-pattern 'RPP-0146|RPP-0166|RPP-0186' test/generated-push-harness.test.js test/rpp-0186-wp-options-serialized-option-changes-release-verifier-v5.test.js
node --test test/rpp-0464-wp-options-driver-semantics-v4.test.js test/rpp-0484-wp-options-release-verifier-v5.test.js
node scripts/release/artifact-redaction-scan.mjs docs/evidence/rpp-0448-serialized-option-validator-v3.md
git diff --check
git diff --cached --check
```

Observed result before commit: all commands exited 0. The focused RPP-0448
test reported two subtests ok and zero failures. The existing serialized option
validator lineage reported three subtests ok and zero failures. The generated
serialized option lineage reported four subtests ok and zero failures. The
adjacent `wp_options` plugin-driver lineage reported four subtests ok and zero
failures. The scoped artifact redaction scan returned `"ok": true`, and both
diff checks returned no whitespace errors.

## Release posture

This lane is local generated-style support evidence only. It proves the
serialized option validator has a safe local mutation path, stale/invalid
payloads fail before mutation, and emitted evidence is hash-only. It does not
provide checked production-backed release evidence. Final release remains
`NO-GO`.
