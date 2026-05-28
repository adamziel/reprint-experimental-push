# RPP-0230 planner summary count consistency v2

Status: focused generated-harness proof added for variant 2. Release remains NO-GO.

## Scenario

The generated harness now has a dedicated `RPP-0230` test that replans every deterministic generated case twice and records summary-only evidence. For each case, `plan.summary` must exactly match the emitted mutation, decision, conflict, blocker, and atomic-group arrays. The evidence is aggregated and compared with the generated harness report totals for statuses, tiers, feature families, and planner summary totals.

## Command and caveat

Command:

```sh
node --test --test-name-pattern=RPP-0230 test/generated-push-harness.test.js
```

Caveat: this is a local deterministic Node generated-harness proof. It confirms planner summary accounting over generated fixtures, but release remains gated separately by the full release checklist and CI evidence.

## Additional invariant note

The generated harness contract now distinguishes direct resource blockers from atomic group propagation blockers. Propagation blockers are allowed to reference an emitted grouped mutation because they prevent the whole non-ready plan from applying rather than deleting the mutation evidence needed for audit.
