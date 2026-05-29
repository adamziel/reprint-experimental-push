# RPP-0093 release verifier apply route pre-mutation carry-through

Evidence toward `RPP-0093` release verifier apply route pre-mutation carry-through.

- Command: `node --test test/release-verifier-apply-route-carry-through-focused-regression.test.js`
- Observed status: `pass`; tests: `3/3`; apply route observed status: `412`; failure code: `APPLY_ROUTE_PRE_MUTATION_REQUIRED`.
- Scope: focused test and evidence note only. No shared release-verifier implementation file changed.
- Coverage: the focused regression pins the release verifier source path that wraps `npm run verify:release`, carries the apply-revalidation `PRECONDITION_FAILED` status `412` / `before-first-mutation` evidence into `check-release-gates`, and verifies the fail-closed mutation-before-rejection fixture reports status `200` with `APPLY_ROUTE_PRE_MUTATION_REQUIRED`.
- Residual risk: this is a bounded static/fixture carry-through regression; the live Playground topology branch remains gated outside this focused slice.
